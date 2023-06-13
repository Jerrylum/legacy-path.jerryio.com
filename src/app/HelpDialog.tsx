import { Backdrop, Card, Typography } from "@mui/material";
import { makeAutoObservable } from "mobx"
import { observer } from "mobx-react-lite";
import { useAppStores } from "./MainApp";
import { useBackdropDialog } from "./Util";
import { ObserverCheckbox } from "./ObserverCheckbox";
import React from "react";

export enum HelpPage {
  None,
  Welcome,
  About,
}

export class Help {
  private page: HelpPage = HelpPage.None;

  constructor() {
    makeAutoObservable(this);
  }

  close() {
    this.page = HelpPage.None;
  }

  open(page: HelpPage) {
    this.page = page;
  }

  get isOpen() {
    return this.page !== HelpPage.None;
  }

  get currentPage() {
    return this.page;
  }
}

const HelpDialog = observer((props: {}) => {
  const { app, help, appPreferences } = useAppStores();

  const rawGAEnabled = localStorage.getItem("googleAnalyticsEnabled");
  const [isGAEnabled, setIsGAEnabled] = React.useState(rawGAEnabled !== "false"); // UX: Default to true

  React.useEffect(() => {
    setIsGAEnabled(rawGAEnabled !== "false");
    if (rawGAEnabled === null) help.open(HelpPage.Welcome); // UX: Show welcome page if user is new
  }, [help, rawGAEnabled]);

  function onClose() {
    help.close();
    appPreferences.isGoogleAnalyticsEnabled = isGAEnabled;
  }

  useBackdropDialog(help.isOpen, onClose);

  if (!help.isOpen) return null;

  return (
    <Backdrop
      className="help-dialog"
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
      open={true}
      onClick={onClose}
      tabIndex={-1}>
      {
        help.currentPage === HelpPage.Welcome &&
        <Card className="help-welcome-page" onClick={(e) => e.stopPropagation()}>
          <Typography variant="h6" gutterBottom>Welcome</Typography>

          <ObserverCheckbox label="Enable Google Analytics" checked={isGAEnabled} onCheckedChange={setIsGAEnabled} />
        </Card>
      }
      {
        help.currentPage === HelpPage.About &&
        <Card className="help-about-page" onClick={(e) => e.stopPropagation()}>
          <img src="logo512.png" alt="app logo" />
          <Typography variant="h6" gutterBottom align="center">PATH.JERRYIO Version {app.appVersion.version}</Typography>
          <Typography variant="body1" align="center" sx={{ marginBottom: "2rem" }}>Made by Jerry Lum</Typography>
          <Typography variant="body1" align="center">This is a free software licensing under GPL-3.0</Typography>
          <Typography variant="body1" align="center">
            <a target="_blank" rel="noreferrer" href="https://github.com/Jerrylum/path.jerryio">Source Code</a>
            <a target="_blank" rel="noreferrer" href="https://www.tldrlegal.com/license/gnu-general-public-license-v3-gpl-3">License</a>
            <a target="_blank" rel="noreferrer" href="https://github.com/Jerrylum/path.jerryio/blob/main/PRIVACY.md">Privacy Terms</a>
            <a target="_blank" rel="noreferrer" href="https://www.gnu.org/philosophy/free-sw.html">About Free Software</a>
            <a target="_blank" rel="noreferrer" href="https://discord.gg/YY43P53QRa">Join Our Discord Server</a>
          </Typography>
        </Card>
      }
    </Backdrop>
  )
});

export { HelpDialog };