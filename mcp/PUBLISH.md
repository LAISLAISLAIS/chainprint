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

1. Bump `version` in `pyproject.toml` and `SCRIPT_VERSION` in `src/chainprint_mcp/__init__.py` + `remote_script/__init__.py` together.
2. Run tests: `cd mcp && pip install -e ".[dev]" && pytest`
3. Smoke-test install: `uvx --from ./chainprint_mcp-*.whl chainprint-mcp install`

Users install with:

```bash
uvx chainprint-mcp install
uvx chainprint-mcp
```
