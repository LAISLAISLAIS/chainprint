# Publishing chainprint-mcp to PyPI

From the repo root:

```bash
cd mcp
python -m pip install build twine
python -m build
python -m twine upload dist/*
```

Or with uv:

```bash
cd mcp
uv build
uv publish
```

Before publishing:

1. Bump `version` in `pyproject.toml` and `SCRIPT_VERSION` / `__version__` in `src/chainprint_mcp/__init__.py` + both remote scripts together.
2. Run tests: `cd mcp && pip install -e ".[dev]" && pytest`
3. Smoke-test install: `uvx --from ./dist/chainprint_mcp-*.whl chainprint-mcp install`

### Option A — GitHub Action (preferred)

1. Create a PyPI API token (Project: `chainprint-mcp`) and add it as repo secret `PYPI_API_TOKEN`.
2. Either publish a GitHub Release, or run **Actions → Publish chainprint-mcp → Run workflow**.

### Option B — Local

```bash
cd mcp
python -m pip install build twine
python -m build
python -m twine upload dist/*
```

Or with uv:

```bash
cd mcp
uv build
uv publish
```

Users install with:

```bash
uvx chainprint-mcp install
uvx chainprint-mcp
```
