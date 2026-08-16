/**
 * Forget every remembered browser.
 *
 * The lever for when a laptop goes missing or the password changes: everyone is
 * asked for it again next time. Changing OFFICE_KEY alone does not do this —
 * existing grants are tokens, and they would keep working.
 *
 *   npm run forget-devices
 */

import "./env";
import { Store } from "./store";

const gone = new Store().forgetDevices();
console.log(`forgot ${gone} remembered device${gone === 1 ? "" : "s"}`);
