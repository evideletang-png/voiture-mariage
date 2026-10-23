#!/usr/bin/env python3
"""Serveur local pour essayer l'outil : python3 serve.py [port]

Comme « python3 -m http.server », avec deux différences utiles :
  - aucun cache : après une modification, un simple rechargement montre la nouvelle version ;
  - il n'écoute que cet ordinateur (127.0.0.1), pas le réseau de la maison.
Ce serveur sert à tester. Pour vos invités, il faut mettre le dossier en ligne en HTTPS (voir LISEZMOI.md)."""
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f'Outil disponible sur http://localhost:{port}  (Ctrl + C pour arrêter)')
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
