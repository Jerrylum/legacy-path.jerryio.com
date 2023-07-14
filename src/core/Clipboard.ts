import { makeAutoObservable, reaction } from "mobx";
import { getAppStores } from "./MainApp";
import { Control, EndPointControl, Path } from "./Path";
import { Logger } from "./Logger";
import { enqueueInfoSnackbar } from "../app/Notice";
import { UnitConverter, UnitOfLength } from "./Unit";
import { instanceToPlain, plainToClassFromExist, plainToInstance } from "class-transformer";
import { makeId } from "./Util";
import DOMPurify from "dompurify";
import { AddPath, InsertControls, InsertPaths, RemovePathTreeItems } from "./Command";

const logger = Logger("Clipboard");

type ClipboardMessageType = "COPY_PATHS" | "COPY_CONTROLS";

interface ClipboardMessage {
  type: ClipboardMessageType;
  format: string;
  uol: UnitOfLength;
}

interface CopyPathsMessage extends ClipboardMessage {
  type: "COPY_PATHS";
  paths: Record<string, any>[];
}

interface CopyControlsMessage extends ClipboardMessage {
  type: "COPY_CONTROLS";
  controls: Record<string, any>[];
}

function isCopyPathMessage(data: any): data is CopyPathsMessage {
  return typeof data === "object" && data !== null && data.type === "COPY_PATHS";
}

function isCopyControlsMessage(data: any): data is CopyControlsMessage {
  return typeof data === "object" && data !== null && data.type === "COPY_CONTROLS";
}

export class AppClipboard {
  private broadcastChannel: BroadcastChannel | undefined;

  private message: CopyPathsMessage | CopyControlsMessage | undefined;
  private items: Path[] | (Control | EndPointControl)[] | undefined;

  public cut(): boolean {
    const { app } = getAppStores();

    if (this.copy() === false || this.items === undefined) return false;

    app.history.execute(`Cut ${this.items.length} path tree items`, new RemovePathTreeItems(app.paths, this.items));

    return true;
  }

  public copy(): boolean {
    const { app } = getAppStores();

    const selected = app.selectedEntities;
    if (selected.length === 0) return false;

    let message: CopyPathsMessage | CopyControlsMessage;

    const isCopyPaths = selected[0] instanceof Path;
    if (selected.some(e => e instanceof Path !== isCopyPaths)) {
      enqueueInfoSnackbar(logger, "Copying controls and paths together is not supported");
      return false;
    }

    if (isCopyPaths) {
      this.items = selected as Path[];
      this.message = message = {
        type: "COPY_PATHS",
        format: app.format.getName(),
        uol: app.gc.uol,
        paths: instanceToPlain(this.items)
      } as CopyPathsMessage;
    } else {
      this.items = selected as (Control | EndPointControl)[];
      this.message = message = {
        type: "COPY_CONTROLS",
        format: app.format.getName(),
        uol: app.gc.uol,
        controls: instanceToPlain(this.items)
      } as CopyControlsMessage;
    }
    this.broadcastChannel?.postMessage(message);

    return true;
  }

  public paste(): boolean {
    const { app } = getAppStores();
    const purify = DOMPurify();

    if (this.message === undefined) return false;

    const oldUOL = this.message.uol;
    const newUOL = app.gc.uol;
    const uc = new UnitConverter(oldUOL, newUOL);

    if (isCopyPathMessage(this.message)) {
      if (this.message.format !== app.format.getName()) return false;

      const paths = plainToInstance(Path, this.message.paths);
      for (const path of paths) {
        path.uid = makeId(10);
        path.pc = plainToClassFromExist(app.format.buildPathConfig(), path.pc);

        // SECURITY: Sanitize path names, beware of XSS attack from the clipboard
        const temp = purify.sanitize(path.name);
        path.name = temp === "" ? "Path" : temp;

        // ALGO: Link the first vector of each segment to the last vector of the previous segment
        for (let j = 1; j < path.segments.length; j++) {
          path.segments[j].first = path.segments[j - 1].last;
        }

        for (const control of path.controls) {
          control.uid = makeId(10);
          control.x = uc.fromAtoB(control.x);
          control.y = uc.fromAtoB(control.y);
        }
      }

      const interestedPath = app.interestedPath();
      const idx = interestedPath === undefined ? 0 : app.paths.indexOf(interestedPath) + 1;

      app.history.execute(`Paste ${paths.length} paths`, new InsertPaths(app.paths, idx, paths));
      app.setSelected(paths.slice());
    } else {
      const controls: (Control | EndPointControl)[] = [];
      for (const raw of this.message.controls) {
        const control = plainToInstance("heading" in raw ? EndPointControl : Control, raw);
        control.uid = makeId(10);
        control.x = uc.fromAtoB(control.x);
        control.y = uc.fromAtoB(control.y);
        controls.push(control);
      }

      if (app.paths.length === 0) {
        const newPath = new Path(app.format.buildPathConfig());
        app.history.execute(`Add path ${newPath.uid}`, new AddPath(app.paths, newPath));
        app.addExpanded(newPath);
      }

      const entities = app.allEntities;
      const selected = app.selectedEntityIds;
      let idx: number;
      if (selected.length === 0) {
        idx = entities.length; // insert at the end
      } else {
        // ALGO: If findIndex returns -1 for unknown reason, idx = 0 and the command is invalid
        idx = entities.findIndex(e => e.uid === selected[selected.length - 1]) + 1;
      }

      app.history.execute(`Paste ${controls.length} controls`, new InsertControls(entities, idx, controls));
      app.setSelected(controls.slice());
    }

    return true;
  }

  private createBroadcastChannel() {
    if (this.broadcastChannel !== undefined) return undefined;

    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      const channel = new BroadcastChannel("versioning");
      channel.onmessage = event => {
        if (isCopyPathMessage(event.data)) this.message = event.data;
        else if (isCopyControlsMessage(event.data)) this.message = event.data;
      };
      return channel;
    } else {
      return undefined;
    }
  }

  constructor() {
    makeAutoObservable(this);

    this.broadcastChannel = this.createBroadcastChannel();
  }
}

