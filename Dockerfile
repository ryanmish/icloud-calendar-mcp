FROM ghcr.io/astral-sh/uv:0.12.22 AS uv
FROM python:3.13-slim

COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock README.md LICENSE THIRD_PARTY_NOTICES.md ./
COPY src ./src
RUN uv sync --locked --no-dev --no-cache \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin calendar
ENV PATH="/app/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 MCP_BIND_HOST=0.0.0.0
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
CMD ["icloud-calendar-mcp"]
