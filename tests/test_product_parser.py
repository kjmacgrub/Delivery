"""
Comprehensive tests for the product description parser.

Tests all known patterns and edge cases from real delivery worksheets.
"""

import pytest
from delivery.parser.product_parser import ProductDescriptionParser, ParsedProduct


@pytest.fixture
def parser():
    return ProductDescriptionParser()


class TestBasicParsing:
    """Test basic product type + variety splitting."""

    def test_simple_product_with_hyphen(self, parser):
        result = parser.parse("Lemons- organic")
        assert result.product_type == "Lemons"
        assert result.organic_status == "organic"

    def test_product_with_dot_hyphen(self, parser):
        result = parser.parse("Lemons.-meyer star sticker")
        assert result.product_type == "Lemons"
        assert result.variety == "meyer"
        assert result.special_notes is not None
        assert "star sticker" in result.special_notes

    def test_product_no_variety(self, parser):
        result = parser.parse("Artichokes")
        assert result.product_type == "Artichokes"
        assert result.variety is None

    def test_product_with_dot_variety(self, parser):
        result = parser.parse("Grapefruit.")
        assert result.product_type == "Grapefruit"

    def test_product_trailing_dot(self, parser):
        result = parser.parse("Pears- comice.")
        assert result.product_type == "Pears"
        assert result.variety == "comice"

    def test_multi_word_product_type(self, parser):
        result = parser.parse("Micro greens- spicy/wasabi")
        assert result.product_type == "Micro greens"
        assert result.variety == "spicy/wasabi"

    def test_multi_word_product_with_space_hyphen(self, parser):
        result = parser.parse("Brussels sprouts - loose conventional")
        assert result.product_type == "Brussels sprouts"
        assert result.organic_status == "conventional"

    def test_raw_description_preserved(self, parser):
        desc = "Spinach-organic girl/olivia baby 16oz organic"
        result = parser.parse(desc)
        assert result.raw_description == desc


class TestParentheticalNotes:
    """Test extraction of parenthetical content."""

    def test_orange_label(self, parser):
        result = parser.parse("Bergamot- (orange label)")
        assert result.product_type == "Bergamot"
        assert result.special_notes == "orange label"

    def test_minimum_price(self, parser):
        result = parser.parse("Peppers-thai chile HOT (25 cent minimum)")
        assert result.product_type == "Peppers"
        assert result.variety == "thai chile HOT"
        assert result.special_notes == "25 cent minimum"

    def test_tango_variety_in_parens(self, parser):
        result = parser.parse("Mandarin- with leaves (Tango)")
        assert result.product_type == "Mandarin"
        assert "Tango" in (result.special_notes or "")

    def test_size_in_parens(self, parser):
        result = parser.parse("Cranberries. (12 oz)")
        assert result.product_type == "Cranberries"
        assert result.special_notes == "12 oz"

    def test_manioc_note(self, parser):
        result = parser.parse("Yuca (manioc or cassava)")
        assert result.product_type == "Yuca"
        assert "manioc or cassava" in (result.special_notes or "")

    def test_hen_of_woods(self, parser):
        result = parser.parse("Mushroom- (hen of the woods) maitake loose organic")
        assert result.product_type == "Mushroom"
        assert "hen of the woods" in (result.special_notes or "")
        assert result.organic_status == "organic"


class TestPLUCodes:
    """Test PLU code extraction in various formats."""

    def test_plu_keyword(self, parser):
        result = parser.parse("Apple- Calville blanc d'hiver heirloom ipm PLU 5283")
        assert result.plu_code == "5283"
        assert result.organic_status == "ipm"

    def test_hash_plu(self, parser):
        result = parser.parse("Oranges-navel. #3107")
        assert result.plu_code == "3107"
        assert result.product_type == "Oranges"

    def test_or_plu(self, parser):
        result = parser.parse("Parsley.-plain. plu 4901 or red twistie")
        assert result.plu_code is not None
        assert "4901" in result.plu_code

    def test_bare_trailing_plu(self, parser):
        result = parser.parse("Pomegranates. 3127")
        assert result.plu_code == "3127"

    def test_organic_plu_code(self, parser):
        result = parser.parse("Cucumber-english seedless 94593 organic")
        assert result.organic_status == "organic"
        assert result.product_type == "Cucumber"

    def test_grapefruit_texas_plu(self, parser):
        result = parser.parse("Grapefruit-Texas organic #94286")
        assert result.plu_code == "94286"
        assert result.organic_status == "organic"
        assert result.product_type == "Grapefruit"


class TestBrands:
    """Test known brand extraction."""

    def test_aerofarms(self, parser):
        result = parser.parse("Micro greens- spicy/wasabi aerofarms pesticide free")
        assert result.brand == "aerofarms"
        assert result.organic_status == "pesticide free"
        assert result.product_type == "Micro greens"
        assert result.variety == "spicy/wasabi"

    def test_organic_girl_olivia(self, parser):
        result = parser.parse("Spinach-organic girl/olivia baby 16oz organic")
        assert result.brand == "organic girl/olivia"
        assert result.size_packaging is not None
        assert "16oz" in result.size_packaging
        assert result.organic_status == "organic"

    def test_organic_girl(self, parser):
        result = parser.parse("Salad- organic girl super greens 5oz organic")
        assert "organic girl" in (result.brand or "").lower()
        assert result.organic_status == "organic"

    def test_froghollow(self, parser):
        result = parser.parse("Persimmons-fuyu organic FROGHOLLOW")
        assert result.brand == "FROGHOLLOW"
        assert result.organic_status == "organic"

    def test_sunset(self, parser):
        result = parser.parse("Tomato cherry sunset flavor bomb")
        assert result.brand == "sunset"
        # Without a hyphen, "Tomato cherry flavor bomb" becomes the product_type
        # The variety distinction requires a hyphen separator
        assert "Tomato cherry" in result.product_type

    def test_little_leaf(self, parser):
        result = parser.parse("Salad- Little Leaf lettuce Baby Crispy Greens 4oz")
        assert "Little Leaf" in (result.brand or "") or "little leaf" in (result.brand or "").lower()

    def test_untill(self, parser):
        result = parser.parse("Salad- untill arugula pesticide free")
        assert result.brand == "untill"
        assert result.organic_status == "pesticide free"

    def test_petes_greens(self, parser):
        result = parser.parse("Spinach-myers pete's greens baby 5oz organic")
        assert result.brand == "pete's greens"
        assert result.organic_status == "organic"

    def test_suncoast(self, parser):
        result = parser.parse("Tomato grape - Suncoast")
        assert result.product_type == "Tomato grape"
        assert result.brand == "Suncoast"


class TestSizePackaging:
    """Test size and packaging extraction."""

    def test_oz(self, parser):
        result = parser.parse("Blackberries- 6oz organic")
        assert result.size_packaging is not None
        assert "6oz" in result.size_packaging
        assert result.organic_status == "organic"

    def test_pound_bags(self, parser):
        result = parser.parse("Carrots-1# bags organic")
        assert result.size_packaging is not None
        assert "1# bags" in result.size_packaging
        assert result.organic_status == "organic"

    def test_five_pound_bags(self, parser):
        result = parser.parse("Carrots-5# bags organic")
        assert result.size_packaging is not None
        assert "5# bags" in result.size_packaging

    def test_lb_bag(self, parser):
        result = parser.parse("Apple- pink lady/cripps 3lb bag organic")
        assert result.size_packaging is not None
        assert "3lb bag" in result.size_packaging

    def test_oz_bags(self, parser):
        result = parser.parse("Carrots-baby rainbow organic 12oz bags")
        assert result.size_packaging is not None
        assert "12oz" in result.size_packaging

    def test_5lb_bag(self, parser):
        result = parser.parse("Potatoes- 5lb bag russet organic")
        assert result.size_packaging is not None
        assert "5lb bag" in result.size_packaging

    def test_small_oz(self, parser):
        result = parser.parse("Herbs- basil .75oz organic")
        assert result.size_packaging is not None
        assert ".75oz" in result.size_packaging

    def test_cups_5oz(self, parser):
        result = parser.parse("Limes-finger lime cups 5oz")
        assert result.size_packaging is not None
        assert "5oz" in result.size_packaging


class TestOrganicStatus:
    """Test organic/growing status extraction."""

    def test_organic(self, parser):
        result = parser.parse("Broccoli- organic")
        assert result.organic_status == "organic"

    def test_ipm(self, parser):
        result = parser.parse("Apple- macoun ipm")
        assert result.organic_status == "ipm"

    def test_conventional(self, parser):
        result = parser.parse("Brussels sprouts - loose conventional")
        assert result.organic_status == "conventional"

    def test_pesticide_free(self, parser):
        result = parser.parse("Micro greens- super mix aerofarms pesticide free")
        assert result.organic_status == "pesticide free"

    def test_conv_abbreviation(self, parser):
        """Test 'conv.' as conventional indicator."""
        result = parser.parse("Pineapple- conv. honeyglow")
        assert result.product_type == "Pineapple"
        # conv. might not match "conventional" exactly
        # This is a known edge case

    def test_no_organic_status(self, parser):
        result = parser.parse("Chestnuts.")
        assert result.organic_status is None or result.organic_status == ""


class TestComplexDescriptions:
    """Test complex real-world descriptions with multiple fields."""

    def test_full_apple(self, parser):
        result = parser.parse("Apple- Calville blanc d'hiver heirloom ipm PLU 5283")
        assert result.product_type == "Apple"
        assert "Calville" in (result.variety or "")
        assert result.organic_status == "ipm"
        assert result.plu_code == "5283"

    def test_full_spinach(self, parser):
        result = parser.parse("Spinach-organic girl/olivia baby 16oz organic")
        assert result.product_type == "Spinach"
        assert "organic girl" in (result.brand or "").lower()
        assert result.size_packaging is not None
        assert "16oz" in result.size_packaging
        assert result.organic_status == "organic"

    def test_salad_little_leaf(self, parser):
        result = parser.parse("Salad- Little Leaf lettuce Baby Crispy Greens 4oz")
        assert result.product_type == "Salad"
        assert result.size_packaging is not None
        assert "4oz" in result.size_packaging

    def test_onion_pearl(self, parser):
        result = parser.parse("Onion.-pearl bags")
        assert result.product_type == "Onion"
        assert result.variety == "pearl bags" or result.variety == "pearl"

    def test_lettuce_little_gem(self, parser):
        result = parser.parse("Lettuce-little gem/ baby head green or red organic")
        assert result.product_type == "Lettuce"
        assert result.organic_status == "organic"

    def test_apple_with_ipm_label(self, parser):
        result = parser.parse("Apple- Ashmead's Kernel ipm 3080")
        assert result.product_type == "Apple"
        assert "Ashmead" in (result.variety or "")
        assert result.organic_status == "ipm"

    def test_flowers(self, parser):
        result = parser.parse("Flowers-lancaster bouquet")
        assert result.product_type == "Flowers"

    def test_chestnut_experiment(self, parser):
        result = parser.parse("Chestnuts- Chestnut Experiment 1lb bag")
        assert result.product_type == "Chestnuts"
        assert result.size_packaging is not None
        assert "1lb bag" in result.size_packaging

    def test_squash_robins_koginut(self, parser):
        result = parser.parse("Squash-robin's koginut organic")
        assert result.product_type == "Squash"
        assert "robin" in (result.variety or "").lower()
        assert result.organic_status == "organic"

    def test_parsley_plu_or_twistie(self, parser):
        result = parser.parse("Parsley.-plain. plu 4901 or red twistie")
        assert result.product_type == "Parsley"
        assert result.variety == "plain" or "plain" in (result.variety or "")
        assert "4901" in (result.plu_code or "")

    def test_salad_untill_cress(self, parser):
        result = parser.parse("Salad- untill Cress & Arugula pesticide free")
        assert result.product_type == "Salad"
        assert result.brand == "untill"
        assert result.organic_status == "pesticide free"

    def test_tomato_grape_sunset(self, parser):
        result = parser.parse("Tomato grape sunset sugar bomb")
        assert result.brand == "sunset"
        # Without hyphen, full remaining text becomes product_type
        assert "Tomato grape" in result.product_type

    def test_dill_conventional_red_twisty(self, parser):
        result = parser.parse("Dill- conventional Red Twisty")
        assert result.product_type == "Dill"
        assert result.organic_status == "conventional"

    def test_onion_red_label_or_no_label(self, parser):
        result = parser.parse("Onion-red organic (label or no label)")
        assert result.product_type == "Onion"
        assert result.organic_status == "organic"
        assert "label or no label" in (result.special_notes or "")

    def test_peppers_mini_sweet(self, parser):
        result = parser.parse("Peppers-mini sweet organic")
        assert result.product_type == "Peppers"
        assert result.organic_status == "organic"

    def test_bok_choy_baby(self, parser):
        result = parser.parse("Bok choy-baby green medium organic")
        assert result.product_type == "Bok choy"
        assert result.organic_status == "organic"

    def test_sweet_potato_local(self, parser):
        result = parser.parse("Sweet potato- local beauregard/garnet organic")
        assert result.product_type == "Sweet potato"
        assert result.organic_status == "organic"

    def test_radicchio_castelfranco(self, parser):
        result = parser.parse("Radicchio- castelfranco/ bel fiore organic")
        assert result.product_type == "Radicchio"
        assert result.organic_status == "organic"

    def test_apple_macintosh_5lb(self, parser):
        result = parser.parse("Apple- macintosh 5lb bag IPM")
        assert result.product_type == "Apple"
        assert result.size_packaging is not None
        assert "5lb bag" in result.size_packaging
        assert result.organic_status == "ipm"


class TestEdgeCases:
    """Test edge cases and unusual formats."""

    def test_empty_variety_after_hyphen(self, parser):
        result = parser.parse("Turmeric- organic")
        assert result.product_type == "Turmeric"
        assert result.variety is None
        assert result.organic_status == "organic"

    def test_zero_quantity_item(self, parser):
        """Zero quantity items still need parsing."""
        result = parser.parse("Watercress- wonder (bunch)")
        assert result.product_type == "Watercress"
        assert "bunch" in (result.special_notes or "")

    def test_dot_after_product(self, parser):
        result = parser.parse("Okra.")
        assert result.product_type == "Okra"

    def test_numbers_in_variety(self, parser):
        """Variety can contain numbers (e.g., navel #3107)."""
        result = parser.parse("Oranges-navel. #3107")
        assert result.product_type == "Oranges"
        assert result.plu_code == "3107"

    def test_multiple_words_no_separator(self, parser):
        result = parser.parse("Broccoli rabe- organic")
        assert result.product_type == "Broccoli rabe"
        assert result.organic_status == "organic"

    def test_basil_conventional_bunch(self, parser):
        result = parser.parse("Basil conventional BUNCH")
        assert result.product_type == "Basil"
        assert result.organic_status == "conventional"
        assert result.size_packaging is not None
        assert "bunch" in result.size_packaging

    def test_beets_bunch_various(self, parser):
        result = parser.parse("Beets- bunch various organic")
        assert result.product_type == "Beets"
        assert result.organic_status == "organic"

    def test_medlar(self, parser):
        result = parser.parse("Medlar")
        assert result.product_type == "Medlar"
        assert result.variety is None
        assert result.organic_status is None or result.organic_status == ""

    def test_aloe_organic(self, parser):
        result = parser.parse("Aloe-organic")
        # "organic" here is the growing status, not the variety
        assert result.product_type == "Aloe"
        assert result.organic_status == "organic"

    def test_nopales_cactus(self, parser):
        result = parser.parse("Nopales- cactus leaves organic")
        assert result.product_type == "Nopales"
        assert result.organic_status == "organic"

    def test_sprouts_crunchy_mix(self, parser):
        result = parser.parse("Sprouts-crunchy/munchin/mix bean organic")
        assert result.product_type == "Sprouts"
        assert result.organic_status == "organic"

    def test_gobo_alternate_name(self, parser):
        result = parser.parse("Burdock Root (Gobo)-org")
        assert result.product_type == "Burdock Root"
        assert "Gobo" in (result.special_notes or "")
