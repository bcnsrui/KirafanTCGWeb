from pathlib import Path
import os
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_ja_pack import _deepl_auth_key, _load_dotenv

_load_dotenv()
key = (_deepl_auth_key() if True else "")
# _deepl_auth_key exits if missing; wrap for status
print("key_set", True)
print("free_key", key.endswith(":fx"))
print("key_len", len(key))
