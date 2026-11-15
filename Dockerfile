# Railway: static shell (html/js/css/assets) + lobby/duel/auth API on one port.
# Heavy packs (pics/sound/data) stay on GitHub — see DEPLOY.md.
FROM python:3.12-slim

WORKDIR /app

ENV HOST=0.0.0.0
ENV SERVE_STATIC=1
ENV DATA_DIR=/data
ENV PYTHONUNBUFFERED=1

COPY . /app

# Runtime state (sqlite, rooms, duels) — mount a Railway Volume at /data
RUN mkdir -p /data/duels

EXPOSE 8080

CMD ["python", "tools/api_server.py"]
