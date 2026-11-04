import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bookingHasMattressDisposal,
  shouldShowMattressCurbsideReminder,
} from './mattressDisposalReminder.js';

test('detects mattress disposal qty on addons', () => {
  assert.equal(bookingHasMattressDisposal({ addons: { mattressDisposal: 2 } }), true);
  assert.equal(bookingHasMattressDisposal({ addons: { mattressDisposal: 0 } }), false);
  assert.equal(bookingHasMattressDisposal({ mattressDisposal: 1 }), true);
});

test('reminder only when mattress disposal and delivery', () => {
  const delivery = () => true;
  const pickup = () => false;
  const withMattress = { addons: { mattressDisposal: 1 } };
  const without = { addons: { mattressDisposal: 0 } };

  assert.equal(shouldShowMattressCurbsideReminder(withMattress, delivery), true);
  assert.equal(shouldShowMattressCurbsideReminder(withMattress, pickup), false);
  assert.equal(shouldShowMattressCurbsideReminder(without, delivery), false);
});
