"""Read-only inspection of selected PE exports; never loads the DLL."""
import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(os.environ.get("TEMP", "/tmp")) / "stem-analysis-python"))
import capstone
import pefile

parser = argparse.ArgumentParser()
parser.add_argument("dll")
parser.add_argument("--export", default="demucsInitFromMemory")
parser.add_argument("--rva", type=lambda value: int(value, 0))
parser.add_argument("--bytes", type=int, default=1800)
parser.add_argument("--vtable", type=lambda value: int(value, 0))
args = parser.parse_args()
pe = pefile.PE(args.dll)
exports = {s.name.decode(): s.address for s in pe.DIRECTORY_ENTRY_EXPORT.symbols if s.name}
rva = args.rva if args.rva is not None else exports[args.export]
print(json.dumps({name: hex(address) for name, address in exports.items() if name.startswith("demucs") or name == "setThreads"}, indent=2))
base = pe.OPTIONAL_HEADER.ImageBase
if args.vtable is not None:
    import struct
    print([(hex(args.vtable + i * 8), hex(value - base)) for i, value in enumerate(struct.unpack('<16Q', pe.get_data(args.vtable, 128)))])
    sys.exit(0)
engine = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
engine.detail = True
imports = {
    symbol.address: f"{library.dll.decode()}!{symbol.name.decode() if symbol.name else symbol.ordinal}"
    for library in pe.DIRECTORY_ENTRY_IMPORT for symbol in library.imports
}
for instruction in engine.disasm(pe.get_data(rva, args.bytes), base + rva):
    annotation = ""
    for operand in instruction.operands:
        if operand.type == capstone.x86.X86_OP_MEM and operand.mem.base == capstone.x86.X86_REG_RIP:
            address = instruction.address + instruction.size + operand.mem.disp
            if address in imports:
                annotation = " ; " + imports[address]
    print(f"{instruction.address - base:08x}  {instruction.mnemonic:10} {instruction.op_str}{annotation}")
