#!/usr/bin/env python3
"""DSDA dev server — static files from ~/ds-da + proxy /api/* to the board Worker.

Replaces `python3 -m http.server 8897` so cabinet pages on the dsda-dev tailnet
can reach the (staging) board Worker same-origin, exactly like prod where
ds-da.ca/api/* routes to the Worker. Usage:  python3 dev-server.py [port]
"""
import http.server
import socketserver
import os
import sys
import gzip
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.abspath(__file__))
API_TARGET = os.environ.get('DSDA_API_TARGET', 'http://127.0.0.1:8787')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8897


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _proxy(self):
        url = API_TARGET + self.path
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ('host', 'content-length', 'connection', 'accept-encoding')}
        # Ask the Worker for an identity (uncompressed) body: we forward the raw
        # bytes and drop content-encoding, so a gzip body would reach the browser
        # without its Content-Encoding header and fail to decode.
        headers['Accept-Encoding'] = 'identity'
        body = None
        cl = self.headers.get('Content-Length')
        if cl:
            body = self.rfile.read(int(cl))
        req = urllib.request.Request(url, data=body, method=self.command, headers=headers)

        def _decompress(data, resp):
            # The Worker (miniflare) gzips JSON bodies; we drop content-encoding on
            # the way back, so decompress here to keep the browser happy.
            enc = (resp.headers.get('Content-Encoding') if hasattr(resp, 'headers') else '') or ''
            if 'gzip' in enc.lower():
                try:
                    return gzip.decompress(data)
                except Exception:
                    return data
            return data

        try:
            with urllib.request.urlopen(req, timeout=15) as up:
                data = _decompress(up.read(), up)
                self.send_response(up.status)
                for k, v in up.headers.items():
                    if k.lower() in ('transfer-encoding', 'connection', 'content-encoding'):
                        continue
                    self.send_header(k, v)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = _decompress(e.read(), e)
            self.send_response(e.code)
            for k, v in e.headers.items():
                if k.lower() in ('transfer-encoding', 'connection', 'content-encoding'):
                    continue
                self.send_header(k, v)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            msg = ('dev api proxy error: %s' % e).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def do_GET(self):
        if self.path.startswith('/api/'):
            return self._proxy()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            return self._proxy()
        return super().do_POST()

    def log_message(self, fmt, *args):
        sys.stderr.write("[dev:%d] %s\n" % (PORT, fmt % args))


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    print("DSDA dev server on :%d  (root=%s, /api -> %s)" % (PORT, ROOT, API_TARGET), flush=True)
    Server(('0.0.0.0', PORT), Handler).serve_forever()
