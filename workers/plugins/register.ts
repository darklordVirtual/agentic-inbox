/**
 * Plugin registration — import this module once as a side effect
 * (e.g. in workers/app.ts) before any request handling starts.
 */

import { pluginRegistry } from "./loader";
import { debtControlPlugin } from "../../plugins/debt-control/index";

pluginRegistry.register(debtControlPlugin);
