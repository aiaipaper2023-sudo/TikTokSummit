#!/usr/bin/env python3
"""Simple HTTP server for TikTokSummit portal on port 8780."""
import http.server
import socketserver
import os

PORT = 8780
DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(DIR)

handler = http.server.SimpleHTTPRequestHandler
with socketserver.TCPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"TikTokSummit portal serving on http://127.0.0.1:{PORT}")
    httpd.serve_forever()
