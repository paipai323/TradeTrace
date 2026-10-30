"""Read-only client for MT5's built-in local MCP server."""
import json
import urllib.request
import urllib.error
from urllib.parse import urlparse
from datetime import datetime, timezone


def decode_result(result):
    if result.get('isError'):
        raise ValueError('MT5 rejected the history request. Check MCP access settings.')
    if 'structuredContent' in result:
        return result['structuredContent']
    texts = [block['text'] for block in result.get('content', []) if block.get('type') == 'text']
    for text in texts:
        try:
            return json.loads(text)
        except ValueError:
            continue
    raise ValueError('MT5 returned a history format this app cannot read yet. No SL/TP values were changed.')


def objects(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from objects(item)
    elif isinstance(value, list):
        for item in value:
            yield from objects(item)


def date_arguments(schema, start, end):
    args = {}
    first = {'from', 'from_date', 'date_from', 'start', 'start_date', 'start_time', 'from_time', 'time_from'}
    last = {'to', 'to_date', 'date_to', 'end', 'end_date', 'end_time', 'to_time', 'time_to'}
    properties = schema.get('properties', {})
    for name, prop in properties.items():
        point = start if name in first else end if name in last else None
        if point is not None:
            if prop.get('type') in ('integer', 'number'):
                args[name] = int(point.timestamp())
            elif prop.get('format') == 'date-time':
                args[name] = point.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
            elif prop.get('format') == 'date':
                args[name] = point.strftime('%Y-%m-%d')
            else:
                args[name] = point.astimezone(timezone.utc).strftime('%Y.%m.%d %H:%M:%S')
    unknown = set(schema.get('required', [])) - set(args)
    for name in list(unknown):
        if 'default' in properties.get(name, {}):
            args[name] = properties[name]['default']
            unknown.remove(name)
    if unknown:
        raise ValueError('This MT5 history API requires unsupported parameters: ' + ', '.join(sorted(unknown)))
    return args


class NativeHistory:
    ALLOWED = {'get_trading_account_info', 'get_trading_history_positions', 'get_trading_history_orders'}

    def __init__(self, url, key):
        parsed = urlparse(url)
        if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Use the MT5 local endpoint, for example http://127.0.0.1:22346/mcp.')
        if not key.strip():
            raise ValueError('Enter the API key from MT5 Tools > Options > MCP.')
        self.url, self.key, self.session, self.request_id = url, key.strip(), None, 0
        self.protocol = '2025-03-26'
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        initialized = self.rpc('initialize', dict(protocolVersion=self.protocol, capabilities={}, clientInfo=dict(name='MT5Replay', version='0.6.0')))
        self.protocol = initialized.get('protocolVersion', self.protocol)
        self.rpc('notifications/initialized', notification=True)
        self.tools = {tool['name']: tool for tool in self.rpc('tools/list').get('tools', [])}
        if not {'get_trading_account_info', 'get_trading_history_positions'}.issubset(self.tools):
            raise ValueError('This endpoint does not expose MT5 terminal account and position history. Use the terminal MCP address, not MetaEditor.')

    def rpc(self, method, params=None, notification=False):
        self.request_id += 1
        payload = dict(jsonrpc='2.0', method=method)
        if not notification:
            payload['id'] = self.request_id
        if params is not None:
            payload['params'] = params
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Authorization': 'Bearer ' + self.key}
        if self.session:
            headers['Mcp-Session-Id'] = self.session
            headers['MCP-Protocol-Version'] = self.protocol
        request = urllib.request.Request(self.url, data=json.dumps(payload).encode(), headers=headers)
        try:
            with self.opener.open(request, timeout=15) as response:
                self.session = response.headers.get('Mcp-Session-Id', self.session)
                if notification:
                    return {}
                if 'text/event-stream' in response.headers.get('Content-Type', ''):
                    size, data, message = 0, [], {}
                    while True:
                        raw = response.readline(8 * 1024 * 1024 + 1)
                        size += len(raw)
                        if size > 8 * 1024 * 1024:
                            raise ValueError('MT5 response exceeds 8 MB.')
                        line = raw.decode('utf-8-sig').rstrip('\r\n')
                        if line.startswith('data:'):
                            data.append(line[5:].lstrip())
                        if (not line or not raw) and data:
                            candidate = json.loads('\n'.join(data))
                            data = []
                            if candidate.get('id') == self.request_id:
                                message = candidate
                                break
                        if not raw:
                            break
                else:
                    raw = response.read(8 * 1024 * 1024 + 1)
                    if len(raw) > 8 * 1024 * 1024:
                        raise ValueError('MT5 response exceeds 8 MB. Choose a shorter history period.')
                    message = json.loads(raw.decode('utf-8-sig'))
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise ValueError('MT5 API key was rejected. Check Tools > Options > MCP in the signed-in terminal.')
            raise ValueError(f'MT5 local API returned HTTP {error.code}. Check its MCP settings.')
        except (OSError, ValueError) as error:
            if isinstance(error, ValueError):
                raise
            raise ValueError('Cannot reach the MT5 local API. Enable its internal MCP server and check its address.')
        if message.get('error'):
            raise ValueError('MT5 local API rejected the request. Check compatibility and permissions.')
        if message.get('id') != self.request_id:
            raise ValueError('MT5 returned no matching response for this request.')
        return message.get('result', {})

    def call(self, name, arguments=None):
        if name not in self.ALLOWED:
            raise ValueError('Only account and historical data requests are permitted.')
        return decode_result(self.rpc('tools/call', dict(name=name, arguments=arguments or {})))

    def verify_account(self, account, server):
        result = self.call('get_trading_account_info')
        for row in objects(result):
            login = row.get('login', row.get('account_login', row.get('account')))
            broker = row.get('server', row.get('account_server'))
            if str(login) == str(account) and broker == server:
                return
        raise ValueError('Cannot confirm this local API belongs to the connected MT5 account and server. No levels loaded.')

    def positions(self, start, end):
        schema = self.tools['get_trading_history_positions'].get('inputSchema', {})
        return self.call('get_trading_history_positions', date_arguments(schema, start, end))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
