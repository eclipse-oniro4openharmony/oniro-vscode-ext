import { describe, expect, it } from '@ohos/hypium';
import testNapi from 'libentry.so';

// Unit tests for the native library built from src/main/cpp (napi_init.cpp).
export default function napiTest() {
  describe('NapiTest', () => {
    it('addsTwoNumbers', 0, () => {
      expect(testNapi.add(2, 3)).assertEqual(5);
    })

    it('addsNegativeAndFractional', 0, () => {
      expect(testNapi.add(-1.5, 0.5)).assertEqual(-1);
    })
  })
}
