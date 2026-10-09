"""Reject incomplete source trees instead of producing an unusable wheel."""

from pathlib import Path

from setuptools import setup


engine = Path(__file__).resolve().parent / "dglz_engine" / "dist"
if not (
    engine / "node_modules" / "@dglz" / "headless" / "dist" / "bridge.js"
).is_file():
    raise RuntimeError("缺少内置引擎，请先构建引擎并运行 prepare_package.py。")

setup()
