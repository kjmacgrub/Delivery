"""
CSV delivery worksheet parser (stub for future implementation).

Will be implemented when CSV format delivery files become available.
Uses the same WorksheetParser interface as the PDF parser.
"""

from delivery.parser.base import WorksheetParser


class CSVWorksheetParser(WorksheetParser):
    """
    Parse delivery worksheets from CSV files.

    TODO: Implement when CSV format is defined.
    """

    def validate(self, file_path: str) -> bool:
        return file_path.lower().endswith('.csv')

    def parse(self, file_path: str) -> dict:
        raise NotImplementedError(
            "CSV parser not yet implemented. "
            "Waiting for CSV format specification."
        )
