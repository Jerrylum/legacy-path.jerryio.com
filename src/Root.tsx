import "./App.scss";

import { observer } from "mobx-react-lite";

import { ThemeProvider } from "@mui/material/styles";

import { Box, Card } from "@mui/material";
import { useCustomHotkeys, useDragDropFile, useUnsavedChangesPrompt } from "./core/Hook";
import { MenuAccordion } from "./app/MenuAccordion";
import { GeneralConfigAccordion } from "./app/GeneralConfigAccordion";
import { PathConfigAccordion } from "./app/PathAccordion";
import { ControlAccordion } from "./app/ControlAccordion";
import { GraphCanvasElement } from "./app/GraphCanvasElement";
import { FieldCanvasElement } from "./app/FieldCanvasElement";
import { useAppStores } from "./core/MainApp";

import classNames from "classnames";
import { onDownload, onDownloadAs, onDropFile, onNew, onOpen, onSave, onSaveAs } from "./core/InputOutput";
import { NoticeProvider } from "./app/Notice";
import { ConfirmationDialog } from "./app/Confirmation";
import { HelpDialog } from "./app/HelpDialog";
import { PreferencesDialog } from "./app/Preferences";
import { DragDropBackdrop } from "./app/DragDropBackdrop";
import { RemovePathsAndEndControls } from "./core/Command";
import React from "react";
import { PathTreeAccordion } from "./app/PathTreeAccordion";
import { FormTags } from "react-hotkeys-hook/dist/types";

const Root = observer(() => {
  const { app, confirmation, help, appPreferences, clipboard } = useAppStores();

  const isUsingEditor = !confirmation.isOpen && !help.isOpen && !appPreferences.isOpen;
  const { isDraggingFile, onDragEnter, onDragLeave, onDragOver, onDrop } = useDragDropFile(
    isUsingEditor,
    onDropFile.bind(null, app, confirmation)
  );

  const ENABLE_EXCEPT_INPUT_FIELD = { enabled: isUsingEditor && !isDraggingFile };

  // UX: Enable custom hotkeys on input fields (e.g. Mod+S) to prevent accidentally triggering the browser default
  // hotkeys when focusing them (e.g. Save page). However, we do not apply it to all hotkeys, because we want to keep
  // some browser default hotkeys on input fields (e.g. Mod+Z to undo user input) instead of triggering custom hotkeys
  // (e.g. Mod+Z to undo field change)
  const ENABLE_ON_ALL_INPUT_FIELDS = {
    ...ENABLE_EXCEPT_INPUT_FIELD,
    enableOnContentEditable: true,
    enableOnFormTags: true
  };
  const ENABLE_ON_NON_TEXT_INPUT_FIELDS = {
    ...ENABLE_EXCEPT_INPUT_FIELD,
    preventDefaultOnlyIfEnabled: true,
    enableOnFormTags: ["input", "INPUT"] as FormTags[],
    // UX: It is okay to enable hotkeys on some input fields (e.g. checkbox, button, range)
    enabled: (kvEvt: KeyboardEvent) => {
      if (ENABLE_EXCEPT_INPUT_FIELD.enabled === false) return false;
      if (kvEvt.target instanceof HTMLInputElement)
        return ["button", "checkbox", "radio", "range", "reset", "submit"].includes(kvEvt.target.type);
      else return true;
    }
  };

  useCustomHotkeys("Mod+P", onNew.bind(null, app, confirmation), ENABLE_ON_ALL_INPUT_FIELDS);
  useCustomHotkeys("Mod+O", onOpen.bind(null, app, confirmation), ENABLE_ON_ALL_INPUT_FIELDS);
  useCustomHotkeys("Mod+S", onSave.bind(null, app, confirmation), ENABLE_ON_ALL_INPUT_FIELDS);
  useCustomHotkeys("Shift+Mod+S", onSaveAs.bind(null, app, confirmation), ENABLE_ON_ALL_INPUT_FIELDS);
  useCustomHotkeys("Mod+D", onDownload.bind(null, app, confirmation), ENABLE_ON_ALL_INPUT_FIELDS);
  useCustomHotkeys("Shift+Mod+D", onDownloadAs.bind(null, app, confirmation), ENABLE_ON_ALL_INPUT_FIELDS);
  useCustomHotkeys("Mod+Comma", () => appPreferences.open(), ENABLE_ON_ALL_INPUT_FIELDS);
  useCustomHotkeys("Mod+X", () => clipboard.cut(), ENABLE_ON_NON_TEXT_INPUT_FIELDS);
  useCustomHotkeys("Mod+C", () => clipboard.copy(), ENABLE_ON_NON_TEXT_INPUT_FIELDS);
  useCustomHotkeys("Mod+V", () => clipboard.paste(), ENABLE_ON_NON_TEXT_INPUT_FIELDS);

  useCustomHotkeys("Mod+Z", () => app.history.undo(), ENABLE_ON_NON_TEXT_INPUT_FIELDS);
  useCustomHotkeys("Mod+Y,Shift+Mod+Z", () => app.history.redo(), ENABLE_ON_NON_TEXT_INPUT_FIELDS);
  useCustomHotkeys(
    "Mod+A",
    () => {
      const path = app.selectedPath;
      const all = path !== undefined ? [path, ...path.controls] : app.allEntities;
      app.setSelected(all);
    },
    ENABLE_ON_NON_TEXT_INPUT_FIELDS
  );
  useCustomHotkeys("Esc", () => app.clearSelected(), ENABLE_EXCEPT_INPUT_FIELD);
  useCustomHotkeys(
    "Shift+Mod+A",
    () => {
      const path = app.selectedPath;
      const all = path !== undefined ? [path, ...path.controls] : app.allEntities;
      app.setSelected(all.filter(e => !app.selectedEntities.includes(e)));
    },
    ENABLE_ON_ALL_INPUT_FIELDS
  );

  useCustomHotkeys("Mod+B", () => (app.view.showSpeedCanvas = !app.view.showSpeedCanvas), ENABLE_ON_ALL_INPUT_FIELDS);
  useCustomHotkeys("Mod+J", () => (app.view.showRightPanel = !app.view.showRightPanel), ENABLE_ON_ALL_INPUT_FIELDS);

  useCustomHotkeys("Mod+Add,Mod+Equal", () => (app.fieldScale += 0.5), ENABLE_ON_ALL_INPUT_FIELDS);
  useCustomHotkeys("Mod+Subtract,Mod+Minus", () => (app.fieldScale -= 0.5), ENABLE_ON_ALL_INPUT_FIELDS);
  useCustomHotkeys("Mod+0", () => app.resetFieldDisplay(), ENABLE_ON_ALL_INPUT_FIELDS);

  useCustomHotkeys("R", () => (app.gc.showRobot = !app.gc.showRobot), ENABLE_ON_NON_TEXT_INPUT_FIELDS);

  useCustomHotkeys(
    "Backspace,Delete",
    () => {
      const command = new RemovePathsAndEndControls(app.paths, app.selectedEntityIds);
      app.history.execute(`Remove paths and end controls`, command);
    },
    ENABLE_ON_NON_TEXT_INPUT_FIELDS
  );

  useUnsavedChangesPrompt();

  React.useEffect(() => app.onUIReady(), [app]);

  // XXX: set key so that the component will be reset when format is changed or app.gc.uol is changed
  return (
    <Box
      tabIndex={-1}
      className={classNames("App", appPreferences.theme.className)}
      {...{ onDragEnter, onDragOver, onDrop }}
      key={app.format.uid + "-" + app.gc.uol}>
      <ThemeProvider theme={appPreferences.theme.theme}>
        <NoticeProvider />
        <Box id="left-editor-panel">
          <MenuAccordion />
          <PathTreeAccordion />
        </Box>

        <Box id="middle-panel" className={app.view.showSpeedCanvas ? "" : "full-height"}>
          <Card id="field-panel">
            <FieldCanvasElement />
          </Card>
          {app.view.showSpeedCanvas && (
            <Card id="graph-panel">
              <GraphCanvasElement />
            </Card>
          )}
        </Box>
        {app.view.showRightPanel && (
          <Box id="right-editor-panel">
            <GeneralConfigAccordion />
            <ControlAccordion />
            <PathConfigAccordion />
          </Box>
        )}
        <ConfirmationDialog />
        <HelpDialog />
        <PreferencesDialog />
        {isUsingEditor && isDraggingFile && <DragDropBackdrop {...{ onDragEnter, onDragLeave, onDragOver, onDrop }} />}
      </ThemeProvider>
    </Box>
  );
});

export default Root;
