// Keeps the translation layer on the app's language setting.

import { setLanguage } from "./index";
import { useApp } from "../state/app";

setLanguage(useApp.getState().settings.language);
useApp.subscribe((state, previous) => {
  if (state.settings.language !== previous.settings.language) setLanguage(state.settings.language);
});
