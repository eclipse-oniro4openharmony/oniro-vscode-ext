import { UIAbility, Want } from '@kit.AbilityKit';
import { abilityDelegatorRegistry, Component, Driver, ON } from '@kit.TestKit';
import { beforeAll, describe, expect, it } from '@ohos/hypium';

const delegator: abilityDelegatorRegistry.AbilityDelegator = abilityDelegatorRegistry.getAbilityDelegator();
const bundleName: string = abilityDelegatorRegistry.getArguments().bundleName;

// UI tests for pages/Index: they start the app's EntryAbility, then drive the
// page through UiTest's Driver.
export default function indexTest() {
  describe('IndexTest', () => {
    beforeAll(async () => {
      const want: Want = { bundleName: bundleName, abilityName: 'EntryAbility' };
      await delegator.startAbility(want);
      await Driver.create().waitForComponent(ON.id('HelloWorld'), 5000);
    })

    it('showsEntryAbility', 0, async () => {
      const ability: UIAbility = await delegator.getCurrentTopAbility();
      expect(ability.context.abilityInfo.name).assertEqual('EntryAbility');
    })

    it('tapShowsWelcome', 0, async () => {
      const driver: Driver = Driver.create();
      const greeting: Component = await driver.findComponent(ON.id('HelloWorld'));
      expect(await greeting.getText()).assertEqual('Hello World');
      await greeting.click();
      await driver.delayMs(500);
      const updated: Component = await driver.findComponent(ON.id('HelloWorld'));
      expect(await updated.getText()).assertEqual('Welcome');
    })
  })
}
