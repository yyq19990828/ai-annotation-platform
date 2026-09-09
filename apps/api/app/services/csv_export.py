"""Keep untrusted text literal when administrators open CSV in spreadsheets."""


def csv_literal(value: str) -> str:
    if value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(
        ("\t", "\r", "\n")
    ):
        return "'" + value
    return value
