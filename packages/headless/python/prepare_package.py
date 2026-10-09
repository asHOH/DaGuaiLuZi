"""Stage the already-built engine; consumers need only Python and Node.js."""

import json
from pathlib import Path
import shutil


def prepare():
    here = Path(__file__).resolve().parent
    packages = here.parents[1]
    destination = here / "dglz_engine" / "dist"
    # Validate inputs before replacing previously staged data.
    names = ("headless", "game-core", "game-rules", "protocol")
    for name in names:
        if not (packages / name / "dist" / "index.js").is_file():
            raise RuntimeError("请先运行 pnpm --filter @dglz/headless... build。")
    zod = (packages / "protocol" / "node_modules" / "zod").resolve(strict=True)
    if destination.exists():
        shutil.rmtree(destination)
    modules = destination / "node_modules"
    for name in names:
        source = packages / name
        target = modules / "@dglz" / name
        shutil.copytree(
            source / "dist",
            target / "dist",
            ignore=shutil.ignore_patterns("*.map", "*.ts"),
        )
        shutil.copy2(source / "package.json", target / "package.json")
    shutil.copytree(
        zod,
        modules / "zod",
        ignore=shutil.ignore_patterns("src", "*.map", "*.ts", "*.cts"),
    )
    examples = here / "examples"
    if examples.exists():
        shutil.copytree(examples, destination / "examples")
    (destination / "versions.json").write_text(
        json.dumps(
            {
                "node": (packages.parent / ".node-version").read_text().strip(),
                "python": "3.12.12",
                "zod": json.loads((zod / "package.json").read_text())["version"],
            }
        ),
        encoding="utf-8",
    )
    print("已准备 Python 包内置引擎。")


if __name__ == "__main__":
    prepare()
