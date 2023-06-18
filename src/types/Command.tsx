import { MainApp } from "../app/MainApp";
import { InteractiveEntity } from "./Canvas";
import { Control, EndPointControl, Keyframe, KeyframePos, Path, Segment, SegmentVariant, Vector } from "./Path";

export interface Execution {
  title: string;
  command: CancellableCommand;
  time: number;
  mergeTimeout: number;
}

export class CommandHistory {
  private lastExecution: Execution | undefined = undefined;
  private history: CancellableCommand[] = [];
  private redoHistory: CancellableCommand[] = [];
  private savedCommand: CancellableCommand | undefined = undefined;

  constructor(private app: MainApp) { }

  execute(title: string, command: CancellableCommand, mergeTimeout = 500): void {
    command.execute();

    const exe = { title, command, time: Date.now(), mergeTimeout };

    if (exe.title === this.lastExecution?.title &&
      isMergeable(exe.command) &&
      isMergeable(this.lastExecution.command) &&
      typeof (exe.command) === typeof (this.lastExecution.command) &&
      exe.time - this.lastExecution.time < exe.mergeTimeout &&
      this.lastExecution.command.merge(exe.command)) {
      this.lastExecution.time = exe.time;
    } else {
      this.commit();
      this.lastExecution = exe;

      console.log("EXECUTE", exe.title);
    }

    this.redoHistory = [];
  }

  commit(): void {
    if (this.lastExecution !== undefined) {
      this.history.push(this.lastExecution.command);
      this.lastExecution = undefined;
    }
  }

  undo(): void {
    this.commit();
    if (this.history.length > 0) {
      const command = this.history.pop()!;
      command.undo();
      this.redoHistory.push(command);

      if (isInteractiveEntitiesCommand(command)) this.app.setSelected(command.entities);
    }
    console.log("UNDO", this.history.length, "->", this.redoHistory.length);
  }

  redo(): void {
    const command = this.redoHistory.pop();
    if (command !== undefined) {
      command.redo();
      this.history.push(command);

      if (isInteractiveEntitiesCommand(command)) this.app.setSelected(command.entities);
    }
    console.log("REDO", this.history.length, "<-", this.redoHistory.length);
  }

  clearHistory(): void {
    this.lastExecution = undefined;
    this.history = [];
    this.redoHistory = [];
    this.savedCommand = undefined;
  }

  save(): void {
    this.commit();
    this.savedCommand = this.history[this.history.length - 1];
  }

  isModified(): boolean {
    this.commit();
    // ALGO: savedCommand can be undefined and the function can return true if the history is empty but redoHistory is not
    return this.savedCommand !== this.history[this.history.length - 1];
  }
}

export interface Command {
  execute(): void;
}

export interface MergeableCommand extends Command {
  merge(command: MergeableCommand): boolean;
}

export interface CancellableCommand extends Command {
  undo(): void;
  redo(): void;
}

export interface InteractiveEntitiesCommand extends Command {
  // The entities that are affected by this command, highlighted in the canvas when undo/redo
  entities: InteractiveEntity[];
}

export function isMergeable(object: Command): object is MergeableCommand {
  return 'merge' in object;
}

export function isInteractiveEntitiesCommand(object: Command): object is InteractiveEntitiesCommand {
  return 'entities' in object;
}

/**
 * ALGO: Assume execute() function are called before undo(), redo() and other functions defined in the class
 */

export class UpdateInstancesProperties<TTarget> implements CancellableCommand, MergeableCommand {
  protected previousValue?: Partial<TTarget>[];

  constructor(protected targets: TTarget[], protected newValues: Partial<TTarget>) { }

  execute(): void {
    this.previousValue = [];
    for (let i = 0; i < this.targets.length; i++) {
      this.previousValue.push(this.updatePropertiesForTarget(this.targets[i], this.newValues));
    }
  }

  undo(): void {
    for (let i = 0; i < this.targets.length; i++) {
      this.updatePropertiesForTarget(this.targets[i], this.previousValue![i]);
    }
    this.previousValue = undefined;
  }

  redo(): void {
    this.execute();
  }

  merge(latest: UpdateInstancesProperties<TTarget>): boolean {
    // ALGO: Assume that the targets are the same and both commands are executed
    for (let i = 0; i < this.targets.length; i++) {
      this.previousValue![i] = { ...latest.previousValue![i], ...this.previousValue![i] };
      this.newValues = { ...this.newValues, ...latest.newValues };
    }
    return true;
  }

  protected updatePropertiesForTarget(target: TTarget, values: Partial<TTarget>): Partial<TTarget> {
    const previousValues: Partial<TTarget> = {} as Partial<TTarget>;
    for (const key in values) {
      previousValues[key] = target[key];
      target[key] = values[key]!;
    }

    return previousValues;
  }
}

export class UpdateProperties<TTarget> extends UpdateInstancesProperties<TTarget> {
  constructor(protected target: TTarget, protected newValues: Partial<TTarget>) {
    super([target], newValues);
  }
}

export class UpdateInteractiveEntities<TTarget extends InteractiveEntity> extends UpdateInstancesProperties<TTarget> implements InteractiveEntitiesCommand {
  constructor(protected targets: TTarget[], protected newValues: Partial<TTarget>) {
    super(targets, newValues);
  }

  get entities(): TTarget[] {
    return this.targets.slice();
  }
}

export class AddSegment implements CancellableCommand, InteractiveEntitiesCommand {
  protected _entities: InteractiveEntity[] = [];

  protected forward: boolean = true;
  protected segment?: Segment;

  constructor(protected path: Path, protected end: EndPointControl, protected variant: SegmentVariant) { }

  protected addLine(): void {
    if (this.path.segments.length === 0) {
      this.segment = new Segment(new EndPointControl(0, 0, 0), [], this.end);
      this._entities.push(this.end);
    } else {
      const last = this.path.segments[this.path.segments.length - 1];
      this.segment = new Segment(last.last, [], this.end);
      this._entities.push(this.end);
    }
    this.path.segments.push(this.segment);
  }

  protected addCurve(): void {
    const p3 = this.end;

    if (this.path.segments.length === 0) {
      const p0 = new EndPointControl(0, 0, 0);
      const p1 = new Control(p0.x, p0.y + 24);
      const p2 = new Control(p3.x, p3.y - 24);
      this.segment = new Segment(p0, [p1, p2], p3);
      this._entities.push(p0, p1, p2, p3);
    } else {
      const last = this.path.segments[this.path.segments.length - 1];
      const p0 = last.last;
      const c = last.controls.length < 4 ? last.controls[0] : last.controls[2];
      const p1 = p0.mirror(new Control(c.x, c.y));
      const p2 = p0.divide(new Control(2, 2)).add(p3.divide(new Control(2, 2)));

      this.segment = new Segment(p0, [p1, p2], p3);
      this._entities.push(p1, p2, p3);
    }
    this.path.segments.push(this.segment);
  }

  execute(): void {
    if (this.variant === SegmentVariant.LINEAR) {
      this.addLine();
    } else if (this.variant === SegmentVariant.CURVE) {
      this.addCurve();
    }
    this.forward = true;
  }

  undo(): void {
    this.path.segments.pop();
    this.forward = false;
  }

  redo(): void {
    // this.execute();
    // ALGO: Instead of executing, we just add the segment back
    // ALGO: Assume that the command is executed
    this.path.segments.push(this.segment!);
    this.forward = true;
  }

  get entities(): InteractiveEntity[] {
    return this.forward ? this._entities : [];
  }
}

export class ConvertSegment implements CancellableCommand, InteractiveEntitiesCommand {
  protected previousControls: Control[] = [];
  protected newControls: Control[] = [];

  constructor(protected path: Path, protected segment: Segment, protected variant: SegmentVariant) { }

  protected convertToLine(): void {
    this.segment.controls.splice(1, this.segment.controls.length - 2);
  }

  protected convertToCurve(): void {
    let index = this.path.segments.indexOf(this.segment);
    let found = index !== -1;
    if (!found) return;

    let prev: Segment | null = null;
    if (index > 0) {
      prev = this.path.segments[index - 1];
    }

    let next: Segment | null = null;
    if (index + 1 < this.path.segments.length) {
      next = this.path.segments[index + 1];
    }

    let p0 = this.segment.first;
    let p3 = this.segment.last;

    let p1: Control;
    if (prev !== null) {
      p1 = p0.mirror(prev.controls[prev.controls.length - 2]);
      // ensure is a control point (not an end point)
      p1 = new Control(p1.x, p1.y);
    } else {
      p1 = p0.divide(new Control(2, 2)).add(p3.divide(new Control(2, 2)));
    }

    let p2;
    if (next !== null) {
      p2 = p3.mirror(next.controls[1]);
    } else {
      p2 = p0.divide(new Control(2, 2)).add(p3.divide(new Control(2, 2)));
    }

    this.segment.controls = [p0, p1, p2, p3];
  }

  execute(): void {
    this.previousControls = this.segment.controls.slice();
    if (this.variant === SegmentVariant.LINEAR) {
      this.convertToLine();
    } else if (this.variant === SegmentVariant.CURVE) {
      this.convertToCurve();
    }
    this.newControls = this.segment.controls.slice();
  }

  undo(): void {
    this.segment.controls = this.previousControls.slice();
  }

  redo(): void {
    this.segment.controls = this.newControls.slice();
  }

  get entities(): InteractiveEntity[] {
    return this.segment.controls.slice(1, -1); // exclude first and last
  }
}

export class SplitSegment implements CancellableCommand, InteractiveEntitiesCommand {
  protected _entities: InteractiveEntity[] = [];

  protected forward: boolean = true;

  protected previousOriginalSegmentControls: Control[] = [];
  protected newOriginalSegmentControls: Control[] = [];
  protected newSegment?: Segment;

  constructor(protected path: Path, protected originalSegment: Segment, protected point: EndPointControl) { }

  execute(): void {
    this.previousOriginalSegmentControls = this.originalSegment.controls.slice();

    const index = this.path.segments.indexOf(this.originalSegment);
    const found = index !== -1;
    if (!found) return;

    const cp_count = this.originalSegment.controls.length;
    if (cp_count === 2) {
      const last = this.originalSegment.last;
      this.originalSegment.last = this.point;
      this.newSegment = new Segment(this.point, [], last);
      this.path.segments.splice(index + 1, 0, this.newSegment);

      this._entities = [this.point];
    } else if (cp_count === 4) {
      const p0 = this.originalSegment.controls[0] as EndPointControl;
      const p1 = this.originalSegment.controls[1];
      const p2 = this.originalSegment.controls[2];
      const p3 = this.originalSegment.controls[3] as EndPointControl;

      const a = p1.divide(new Control(2, 2)).add(this.point.divide(new Control(2, 2)));
      const b = this.point;
      const c = p2.divide(new Control(2, 2)).add(this.point.divide(new Control(2, 2)));
      this.originalSegment.controls = [p0, p1, a, b];
      this.newSegment = new Segment(b, [c, p2], p3);
      this.path.segments.splice(index + 1, 0, this.newSegment);

      this._entities = [a, this.point, c];
    }

    this.newOriginalSegmentControls = this.originalSegment.controls.slice();
    this.forward = true;
  }

  undo(): void {
    this.originalSegment.controls = this.previousOriginalSegmentControls;
    const index = this.path.segments.indexOf(this.newSegment!);
    this.path.segments.splice(index, 1);

    this.forward = false;
  }

  redo(): void {
    // this.execute();
    // ALGO: Instead of executing, we just add the segment back
    // ALGO: Assume that the command is executed
    const index = this.path.segments.indexOf(this.originalSegment);
    this.originalSegment.controls = this.newOriginalSegmentControls.slice();
    this.path.segments.splice(index + 1, 0, this.newSegment!);

    this.forward = true;
  }

  get entities(): InteractiveEntity[] {
    return this.forward ? this._entities : [];
  }
}

export class RemoveSegment implements CancellableCommand, InteractiveEntitiesCommand {
  protected _entities: InteractiveEntity[] = [];

  protected forward: boolean = true;
  protected index: number = -1;
  protected segment?: Segment;

  constructor(protected path: Path, protected point: EndPointControl) { }

  execute(): void {
    for (let i = 0; i < this.path.segments.length; i++) {
      const segment = this.path.segments[i];
      if (segment.first === this.point) { // pointer comparison
        // ALGO: This is the first control of the segment
        if (i !== 0) {
          const prev = this.path.segments[i - 1];
          prev.last = segment.last; // pointer assignment

          this._entities = segment.controls.slice(0, -1); // keep the last control
        } else {
          this._entities = segment.controls.slice();
        }
        this.path.segments.splice(i, 1);
      } else if (i + 1 === this.path.segments.length && segment.last === this.point) { // pointer comparison
        // ALGO: This is the last control of the last segment
        if (i !== 0) { // if this segment is not the first segment
          this._entities = segment.controls.slice(1); // keep the first control
        } else {
          this._entities = segment.controls.slice();
        }

        this.path.segments.splice(i, 1);
      } else {
        continue;
      }

      this.index = i;
      this.segment = segment;
      break;
    }

    this.forward = true;
  }

  undo(): void {
    if (this.index === -1) return;

    this.path.segments.splice(this.index, 0, this.segment!);
    if (this.segment?.first === this.point && this.index > 0) {
      const prev = this.path.segments[this.index - 1];
      prev.last = this.segment.first; // pointer assignment
    }

    this.forward = false;
  }

  redo(): void {
    // this.execute();
    // ALGO: Instead of executing, we just add the segment back
    // ALGO: Assume that the command is executed
    if (this.index === -1) return;

    this.path.segments.splice(this.index, 1);
    if (this.segment?.first === this.point && this.index > 0) {
      const prev = this.path.segments[this.index - 1];
      prev.last = this.segment.last; // pointer assignment
    }

    this.forward = true;
  }

  get removedEntities(): InteractiveEntity[] {
    return this._entities;
  }

  get entities(): InteractiveEntity[] {
    return this.forward ? [] : this._entities;
  }
}

export class DragControls implements CancellableCommand, MergeableCommand, InteractiveEntitiesCommand {

  constructor(protected main: Control, protected from: Vector, protected to: Vector, protected followers: Control[]) { }

  execute(): void {
    for (let cp of this.followers) {
      cp.setXY(this.to.add(cp.subtract(this.from)));
    }

    this.main.setXY(this.to);
  }

  undo() {
    for (let cp of this.followers) {
      cp.setXY(this.from.add(cp.subtract(this.to)));
    }

    this.main.setXY(this.from);
  }

  redo() {
    this.execute();
  }

  merge(command: DragControls): boolean {
    // check if followers are the same
    if (this.followers.length !== command.followers.length) return false;

    for (let i = 0; i < this.followers.length; i++) {
      if (this.followers[i] !== command.followers[i]) return false;
    }

    // check if main is the same
    if (this.main !== command.main) return false;

    this.to = command.to;

    return true;
  }

  get entities(): InteractiveEntity[] {
    return [this.main, ...this.followers];
  }
}

export class AddKeyframe implements CancellableCommand {
  protected kf?: Keyframe;

  constructor(protected path: Path, protected pos: KeyframePos) { }

  execute(): void {
    // sort and push
    this.kf = new Keyframe(this.pos.xPos, this.pos.yPos);
    this.pos.segment.speedProfiles.push(this.kf);
    this.pos.segment.speedProfiles.sort((a, b) => a.xPos - b.xPos);
  }

  undo(): void {
    this.pos.segment.speedProfiles.splice(this.pos.segment.speedProfiles.indexOf(this.kf!), 1);
  }

  redo(): void {
    // this.execute();
    // ALGO: Instead of executing, we just add the keyframe back
    // ALGO: Assume that the command is executed
    this.pos.segment.speedProfiles.push(this.kf!);
    this.pos.segment.speedProfiles.sort((a, b) => a.xPos - b.xPos);
  }

  get keyframe(): Keyframe {
    return this.kf!;
  }
}

export class MoveKeyframe implements CancellableCommand, MergeableCommand {
  protected oldPos?: KeyframePos;

  constructor(protected path: Path, protected newPos: KeyframePos, protected kf: Keyframe) { }

  removeKeyframe(pos: KeyframePos) {
    const idx = pos.segment.speedProfiles.indexOf(this.kf);
    if (idx === -1) return;

    pos.segment.speedProfiles.splice(idx, 1);
  }

  addKeyframe(pos: KeyframePos) {
    this.kf.xPos = pos.xPos;
    this.kf.yPos = pos.yPos;
    pos.segment.speedProfiles.push(this.kf);
    pos.segment.speedProfiles.sort((a, b) => a.xPos - b.xPos);
  }

  execute(): void {
    // remove keyframe from oldSegment speed control
    for (const segment of this.path.segments) {
      const idx = segment.speedProfiles.indexOf(this.kf);
      if (idx === -1) continue;

      segment.speedProfiles.splice(idx, 1);
      this.oldPos = { segment, xPos: this.kf.xPos, yPos: this.kf.yPos };
      break;
    }
    this.addKeyframe(this.newPos);
  }

  undo(): void {
    if (!this.oldPos) return;

    this.removeKeyframe(this.newPos);
    this.addKeyframe(this.oldPos);
  }

  redo(): void {
    // this.execute();
    // ALGO: Instead of executing, we just add the keyframe back
    // ALGO: Assume that the command is executed
    if (!this.oldPos) return;

    this.removeKeyframe(this.oldPos);
    this.addKeyframe(this.newPos);
  }

  merge(command: MoveKeyframe) {
    if (command.kf !== this.kf) return false;

    this.newPos = command.newPos;

    return true;
  }
}

export class RemoveKeyframe implements CancellableCommand {
  protected segment?: Segment;
  protected oldIdx = -1;

  constructor(protected path: Path, protected kf: Keyframe) { }

  execute(): void {
    for (const segment of this.path.segments) {
      const idx = segment.speedProfiles.indexOf(this.kf);
      if (idx === -1) continue;

      segment.speedProfiles.splice(idx, 1);
      this.segment = segment;
      this.oldIdx = idx;
      break;
    }
  }

  undo(): void {
    if (this.segment === undefined || this.oldIdx === -1) return;

    this.segment.speedProfiles.splice(this.oldIdx, 0, this.kf);
  }

  redo(): void {
    // this.execute();
    // ALGO: Instead of executing, we just remove the keyframe
    // ALGO: Assume that the command is executed
    if (this.segment === undefined || this.oldIdx === -1) return;

    this.segment.speedProfiles.splice(this.oldIdx, 1);
  }
}

export class AddPath implements CancellableCommand, InteractiveEntitiesCommand {
  protected forward: boolean = false;

  constructor(protected paths: Path[], protected path: Path) { }

  execute(): void {
    this.paths.push(this.path);
    this.forward = true;
  }

  undo(): void {
    this.paths.splice(this.paths.indexOf(this.path), 1);
    this.forward = false;
  }

  redo(): void {
    this.paths.push(this.path);
    this.forward = true;
  }

  get entities(): InteractiveEntity[] {
    return this.forward ? [this.path, ...this.path.controls] : [];
  }
}

export class RemovePath implements CancellableCommand, InteractiveEntitiesCommand {
  protected index: number = -1;
  protected forward: boolean = false;

  constructor(protected paths: Path[], protected path: Path) { }

  execute(): void {
    this.index = this.paths.indexOf(this.path);
    this.paths.splice(this.index, 1);
    this.forward = true;
  }

  undo(): void {
    this.paths.splice(this.index, 0, this.path);
    this.forward = false;
  }

  redo(): void {
    this.paths.splice(this.index, 1);
    this.forward = true;
  }

  get entities(): InteractiveEntity[] {
    return this.forward ? [] : [this.path, ...this.path.controls];
  }
}
