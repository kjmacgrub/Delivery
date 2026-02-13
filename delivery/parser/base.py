"""Abstract base class for delivery worksheet parsers."""

from abc import ABC, abstractmethod
from typing import Any


class WorksheetParser(ABC):
    """
    Abstract base class for delivery worksheet parsers.
    Both PDF and CSV parsers implement this interface,
    making it easy to swap input formats.
    """

    @abstractmethod
    def parse(self, file_path: str) -> dict:
        """
        Parse a file and return structured delivery data.

        Returns a dict with:
            - header: delivery metadata (date, day, week, total_cases)
            - supplier_blocks: list of supplier dicts, each with:
                - supplier_name: str
                - expected_cases: int
                - block_sequence: int
                - items: list of line item dicts
        """
        ...

    @abstractmethod
    def validate(self, file_path: str) -> bool:
        """Check if this parser can handle the given file."""
        ...
