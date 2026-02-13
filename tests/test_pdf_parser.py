"""
Integration tests for the PDF parser against the real sample delivery PDF.
"""

import pytest
from pathlib import Path

from delivery.parser.pdf_parser import PDFWorksheetParser

SAMPLE_PDF = Path(__file__).parent / "fixtures" / "sample_delivery.pdf"


@pytest.fixture
def parser():
    return PDFWorksheetParser()


@pytest.fixture
def parsed(parser):
    """Parse the sample PDF once for all tests."""
    assert SAMPLE_PDF.exists(), f"Sample PDF not found at {SAMPLE_PDF}"
    return parser.parse(str(SAMPLE_PDF))


class TestHeader:
    def test_day_of_week(self, parsed):
        assert parsed['header']['day_of_week'] == 'Monday'

    def test_delivery_date(self, parsed):
        assert parsed['header']['delivery_date'] == '2025-11-24'

    def test_day_number(self, parsed):
        assert parsed['header']['day_number'] == 328

    def test_week_number(self, parsed):
        assert parsed['header']['week_number'] == 48

    def test_total_cases(self, parsed):
        assert parsed['header']['total_cases_expected'] == 2223

    def test_source_filename(self, parsed):
        assert parsed['source_filename'] == 'sample_delivery.pdf'


class TestSupplierBlocks:
    def test_has_suppliers(self, parsed):
        # After merging, we should have 7 unique suppliers
        assert len(parsed['supplier_blocks']) == 7

    def test_no_duplicate_suppliers(self, parsed):
        """Each supplier should appear exactly once after merging."""
        names = [b['supplier_name'] for b in parsed['supplier_blocks']]
        assert len(names) == len(set(names))

    def test_ace_natural(self, parsed):
        blocks = parsed['supplier_blocks']
        ace = [b for b in blocks if b['supplier_name'] == 'Ace Natural Produce']
        assert len(ace) == 1
        assert ace[0]['expected_cases'] == 9

    def test_baldor(self, parsed):
        blocks = parsed['supplier_blocks']
        baldor = [b for b in blocks if b['supplier_name'] == 'Baldor']
        assert len(baldor) == 1
        assert baldor[0]['expected_cases'] == 205

    def test_four_seasons_merged(self, parsed):
        blocks = parsed['supplier_blocks']
        fs = [b for b in blocks if b['supplier_name'] == 'Four Seasons Produce']
        # All 6 blocks should be merged into 1
        assert len(fs) == 1
        # Cases from first occurrence
        assert fs[0]['expected_cases'] == 418
        # Combined items from all blocks
        assert len(fs[0]['items']) == 109

    def test_lancaster_merged(self, parsed):
        blocks = parsed['supplier_blocks']
        lfc = [b for b in blocks if b['supplier_name'] == 'Lancaster Farm Fresh Coop']
        # All 3 blocks merged into 1
        assert len(lfc) == 1
        assert lfc[0]['expected_cases'] == 430
        # Combined items from all blocks
        assert len(lfc[0]['items']) == 65

    def test_myers_merged(self, parsed):
        blocks = parsed['supplier_blocks']
        myers = [b for b in blocks if b['supplier_name'] == 'Myers Produce']
        # 2 blocks merged into 1
        assert len(myers) == 1
        assert myers[0]['expected_cases'] == 137
        assert len(myers[0]['items']) == 37

    def test_jedda(self, parsed):
        blocks = parsed['supplier_blocks']
        jedda = [b for b in blocks if b['supplier_name'] == 'Jedda']
        assert len(jedda) == 1
        assert jedda[0]['expected_cases'] == 432

    def test_dartagnan(self, parsed):
        blocks = parsed['supplier_blocks']
        dt = [b for b in blocks if 'Artagnan' in b['supplier_name']]
        assert len(dt) == 1
        assert dt[0]['expected_cases'] == 5

    def test_block_sequences_are_unique(self, parsed):
        seqs = [b['block_sequence'] for b in parsed['supplier_blocks']]
        assert len(seqs) == len(set(seqs))  # All unique
        assert seqs == sorted(seqs)  # Sequential


class TestLineItems:
    def test_total_items_reasonable(self, parsed):
        total = sum(len(b['items']) for b in parsed['supplier_blocks'])
        # The PDF has approximately 250+ items
        assert total >= 200, f"Only found {total} items, expected 200+"

    def test_items_have_required_fields(self, parsed):
        for block in parsed['supplier_blocks']:
            for item in block['items']:
                assert 'quantity_expected' in item
                assert 'category' in item
                assert 'raw_description' in item
                assert 'product_type' in item
                assert item['category'] in ['CITRUS', 'FRUIT', 'VEG', 'APPLES', 'NUTS', 'FLOWERS']

    def test_baldor_items(self, parsed):
        baldor = [b for b in parsed['supplier_blocks'] if b['supplier_name'] == 'Baldor'][0]
        # Check specific items
        descriptions = [it['raw_description'] for it in baldor['items']]
        # These should all be separate items
        assert any('Bergamot' in d for d in descriptions)
        assert any('Kumquats' in d for d in descriptions)
        assert any('Peppers-thai chile' in d for d in descriptions)

    def test_organic_status_extracted(self, parsed):
        """Check that organic status is parsed for items that have it."""
        organic_count = 0
        for block in parsed['supplier_blocks']:
            for item in block['items']:
                if item.get('organic_status'):
                    organic_count += 1
        # Most items in this worksheet are organic
        assert organic_count > 100

    def test_brands_extracted(self, parsed):
        """Check that known brands are extracted."""
        brands = set()
        for block in parsed['supplier_blocks']:
            for item in block['items']:
                if item.get('brand'):
                    brands.add(item['brand'].lower())
        # Should find at least some of the known brands
        assert len(brands) >= 3


class TestFormattingDetection:
    def test_shaded_items_detected(self, parsed):
        """Items with shading (needs_processing) should be detected."""
        shaded_count = 0
        for block in parsed['supplier_blocks']:
            for item in block['items']:
                if item.get('needs_processing'):
                    shaded_count += 1
        # The Baldor and other blocks have many shaded items
        assert shaded_count > 50, f"Only found {shaded_count} shaded items"

    def test_floor_pull_items_detected(self, parsed):
        """Bold/asterisk items (pull_for_floor) should be detected."""
        floor_pull_count = 0
        for block in parsed['supplier_blocks']:
            for item in block['items']:
                if item.get('pull_for_floor'):
                    floor_pull_count += 1
        # There are several floor pull items
        assert floor_pull_count >= 5, f"Only found {floor_pull_count} floor pull items"

    def test_flowers_is_floor_pull(self, parsed):
        """Flowers-lancaster bouquet should be marked as floor pull."""
        for block in parsed['supplier_blocks']:
            for item in block['items']:
                if 'Flowers' in item['raw_description'] and 'lancaster' in item['raw_description']:
                    assert item['pull_for_floor'], (
                        f"Flowers-lancaster bouquet should be pull_for_floor"
                    )
                    return
        pytest.fail("Flowers-lancaster bouquet not found in parsed items")

    def test_floor_pull_uses_cases_not_pull_number(self, parsed):
        """Floor-pull items should use the cases count (first number), not the pull number."""
        for block in parsed['supplier_blocks']:
            for item in block['items']:
                if 'Flowers' in item['raw_description'] and 'lancaster' in item['raw_description']:
                    # "3 6 * FLOWERS Flowers-lancaster bouquet"
                    # 3 = cases expected, 6 = pull number (ignore)
                    assert item['quantity_expected'] == 3, (
                        f"Flowers-lancaster should have qty=3 (cases), got {item['quantity_expected']}"
                    )
                    return
        pytest.fail("Flowers-lancaster bouquet not found")

    def test_floor_pull_zero_qty(self, parsed):
        """Floor-pull items with 0 cases should have quantity_expected=0."""
        for block in parsed['supplier_blocks']:
            for item in block['items']:
                if 'Beets' in item['raw_description'] and 'bunch various' in item['raw_description']:
                    # "0 1 * VEG Beets- bunch various organic"
                    assert item['quantity_expected'] == 0, (
                        f"Beets bunch various should have qty=0, got {item['quantity_expected']}"
                    )
                    return
        pytest.fail("Beets bunch various not found")


class TestSpecificItems:
    """Test parsing of specific complex items."""

    def test_micro_greens_aerofarms(self, parsed):
        for block in parsed['supplier_blocks']:
            for item in block['items']:
                if 'Micro greens' in item['raw_description'] and 'spicy' in item['raw_description']:
                    assert item['product_type'] == 'Micro greens'
                    assert item['brand'] == 'aerofarms'
                    assert item['organic_status'] == 'pesticide free'
                    return
        pytest.fail("Micro greens spicy/wasabi not found")

    def test_mushroom_maitake(self, parsed):
        for block in parsed['supplier_blocks']:
            if 'Artagnan' in block['supplier_name']:
                assert len(block['items']) >= 1
                item = block['items'][0]
                assert 'Mushroom' in item['product_type']
                assert item['organic_status'] == 'organic'
                return
        pytest.fail("D'Artagnan mushroom not found")

    def test_calville_apple(self, parsed):
        for block in parsed['supplier_blocks']:
            for item in block['items']:
                if 'Calville' in item['raw_description']:
                    assert item['product_type'] == 'Apple'
                    assert 'Calville' in (item['variety'] or '')
                    assert item['organic_status'] == 'ipm'
                    assert item['plu_code'] == '5283'
                    return
        pytest.fail("Calville apple not found")
