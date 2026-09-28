import unittest

from honest_core.validation import validate_order_inputs


class ValidateOrderInputsTests(unittest.TestCase):
    def test_normalizes_valid_input(self):
        self.assertEqual(validate_order_inputs("buy", "2.5"), ("BUY", 2.5))

    def test_rejects_invalid_actions(self):
        with self.assertRaises(ValueError):
            validate_order_inputs("HOLD", 1)

    def test_rejects_non_positive_or_non_finite_quantities(self):
        for quantity in (0, -1, float("nan"), float("inf")):
            with self.subTest(quantity=quantity):
                with self.assertRaises(ValueError):
                    validate_order_inputs("BUY", quantity)

    def test_rejects_non_numeric_quantities(self):
        with self.assertRaises(ValueError):
            validate_order_inputs("SELL", "abc")


if __name__ == "__main__":
    unittest.main()
