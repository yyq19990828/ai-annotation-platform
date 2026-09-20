"""Read one object through the owned runtime's storage client (P7 neighbor probe).

Prints {"bucket","key","size","sha256"} so an E2E spec can assert object
survival by bytes rather than by URL text. Guards keep it on disposable
E2E environments only.
"""

import hashlib
import json
import os
import sys

assert os.environ.get("E2E_SEED_ENABLED") == "true", "storage probe is E2E-only"
assert os.environ.get("ENVIRONMENT") == "development"

from app.services.storage import storage_service  # noqa: E402


def main() -> None:
    (key,) = sys.argv[1:]
    response = storage_service.client.get_object(
        Bucket=storage_service.datasets_bucket, Key=key
    )
    body = response["Body"].read()
    print(
        json.dumps(
            {
                "bucket": storage_service.datasets_bucket,
                "key": key,
                "size": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
            }
        )
    )


if __name__ == "__main__":
    main()
