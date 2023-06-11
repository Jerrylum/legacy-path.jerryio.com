import { Backdrop, Box, Button, Card, Typography } from "@mui/material";
import React, { FocusEventHandler } from "react";
import { MainApp } from "./MainApp";
import { action } from "mobx"
import { observer } from "mobx-react-lite";
import { useCustomHotkeys } from "./Util";

export interface ConfirmationButton {
  label: string;
  onClick?: () => void;
  hotkey?: string;
  color?: "inherit" | "primary" | "secondary" | "success" | "error" | "info" | "warning";
}

export interface Confirmation {
  title: string;
  description: string;
  buttons: ConfirmationButton[];
}

const ConfirmationBackdrop = observer((props: { app: MainApp }) => {
  const ref = React.useRef<HTMLButtonElement | null>(null);

  const cfm = props.app.confirmation;
  if (cfm === undefined) return (<></>);

  function onClick(idx: number) {
    props.app.confirmation = undefined;

    if (idx < 0 || idx >= cfm!.buttons.length) idx = cfm!.buttons.length - 1;

    cfm!.buttons[idx].onClick?.();
  }

  function onKeydown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      onClick(-1); // UX: Escape key always triggers the last button
    } else {
      for (let i = 0; i < cfm!.buttons.length; i++) {
        if (e.key === cfm!.buttons[i].hotkey) {
          onClick(i);
          break;
        }
      }
    }    
  }

  return (
    <Backdrop
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
      open={true}
      onClick={action(onClick.bind(null, -1))}
      onKeyDown={action(onKeydown)} >
      <Card className="confirmation-card" onClick={(e) => e.stopPropagation()} tabIndex={-1}>
        <Typography variant="h6" gutterBottom>{cfm.title}</Typography>
        <Typography variant="body1" gutterBottom>{cfm.description}</Typography>
        <Box className="button-box">
          {
            cfm.buttons.map((btn, i) => {
              return <Button disableRipple key={i} tabIndex={i + 1001} variant="text" color={btn.color ?? "inherit"} autoFocus={i === 0}
                onClick={action(onClick.bind(null, i))}
                {...(i + 1 === cfm.buttons.length ? {
                  onFocus: () => { ref.current!.tabIndex = 1000 },
                  onBlur: () => { ref.current!.tabIndex = i + 1001 },
                  ref
                } : {})}>{btn.label}{btn.hotkey ? `(${btn.hotkey.toUpperCase()})` : ""}</Button>
            })
          }
        </Box>
      </Card>
    </Backdrop>
  );
});

export { ConfirmationBackdrop };