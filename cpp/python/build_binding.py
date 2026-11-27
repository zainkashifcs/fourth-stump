"""Compile the pybind11 binding with the compiler and flags the Makefile passes in.

Usage: python build_binding.py <compiler> <flags...>
The module is linked against the interpreter that runs this script (ADR-002).
"""
import subprocess
import sys
import sysconfig
from pathlib import Path

import pybind11

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    compiler, flags = sys.argv[1], sys.argv[2:]
    target = ROOT / "fourth_stump" / ("_engine" + sysconfig.get_config_var("EXT_SUFFIX"))
    command = [
        compiler, *flags, "-shared", "-fPIC",
        f"-I{sysconfig.get_paths()['include']}", f"-I{pybind11.get_include()}",
        str(ROOT / "cpp" / "python" / "bindings.cpp"), "-o", str(target),
    ]
    if sys.platform == "win32":
        # Link the interpreter's DLL directly and the MinGW runtimes statically, so the
        # module imports with no MSYS2 on PATH.
        dll = Path(sys.base_prefix) / f"python{sys.version_info.major}{sys.version_info.minor}.dll"
        command += [str(dll), "-static"]
    subprocess.run(command, check=True, cwd=ROOT)
    print(f"built {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
