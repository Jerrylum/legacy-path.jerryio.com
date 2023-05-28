import { Exclude, Type } from 'class-transformer';
import { makeAutoObservable } from "mobx"
import { makeId } from "../app/Util";
import { GeneralConfig, SpeedConfig } from "../format/Config";
import { InteractiveEntity, CanvasEntity } from "./Canvas";
import { UnitConverter, UnitOfLength } from './Unit';

import 'reflect-metadata';

export class Vertex {

  constructor(public x: number, public y: number) { }

  add<T extends Vertex>(vector: T): T {
    let rtn = vector.clone() as T;
    rtn.x += this.x;
    rtn.y += this.y;
    return rtn.fixPrecision() as T;
  }

  subtract<T extends Vertex>(vector: T): T {
    let rtn = vector.clone() as T;
    rtn.x = this.x - rtn.x;
    rtn.y = this.y - rtn.y;
    return rtn.fixPrecision() as T;
  }

  multiply<T extends Vertex>(vector: T): T {
    let rtn = vector.clone() as T;
    rtn.x *= this.x;
    rtn.y *= this.y;
    return rtn.fixPrecision() as T;
  }

  divide<T extends Vertex>(vector: T): T {
    let rtn = vector.clone() as T;
    rtn.x = this.x / rtn.x;
    rtn.y = this.y / rtn.y;
    return rtn.fixPrecision() as T;
  }

  dot(vector: Vertex): number {
    return this.x * vector.x + this.y * vector.y;
  }

  distance(vector: Vertex): number {
    return Math.sqrt(Math.pow(this.x - vector.x, 2) + Math.pow(this.y - vector.y, 2));
  }

  interpolate<T extends Vertex>(other: T, distance: number): T {
    // "this" as the center
    let rtn = other.clone() as T;
    // use trig to find the angle between the two points
    const angle = Math.atan2(rtn.y - this.y, rtn.x - this.x);
    // use the angle to find the x and y components of the vector
    rtn.x = this.x + distance * Math.cos(angle);
    rtn.y = this.y + distance * Math.sin(angle);
    return rtn.fixPrecision() as T;
  }

  mirror<T extends Vertex>(other: T): T {
    // "this" as the center
    let rtn = other.clone() as T;
    rtn.x = 2 * this.x - other.x;
    rtn.y = 2 * this.y - other.y;
    return rtn.fixPrecision() as T;
  }

  setXY(other: Vertex): void {
    this.x = other.x;
    this.y = other.y;
    this.fixPrecision();
  }

  fixPrecision(p = 3): Vertex {
    this.x = parseFloat(this.x.toFixed(p));
    this.y = parseFloat(this.y.toFixed(p));
    return this;
  }

  clone(): Vertex {
    return new Vertex(this.x, this.y);
  }
}

export class Knot extends Vertex {
  constructor(x: number, y: number,
    public delta: number, // distance to the previous knot
    public integral: number, // integral distance from the first knot
    public speed: number = 0,
    public heading?: number) {
    super(x, y);
  }

  clone(): Knot {
    return new Knot(this.x, this.y, this.delta, this.integral, this.speed, this.heading);
  }
}

export interface Position extends Vertex {
  heading: number;

  headingInRadian(): number;

  fixPrecision(p: number): Position;

  clone(): Position;
}

export class Control extends Vertex implements InteractiveEntity {
  public uid: string;
  public lock: boolean = false;
  public visible: boolean = true;

  constructor(x: number, y: number) {
    super(x, y);
    this.uid = makeId(10);
  }

  clone(): Control {
    return new Control(this.x, this.y);
  }
}

export class EndPointControl extends Control implements Position {

  constructor(x: number, y: number, public heading: number) {
    super(x, y);
  }

  headingInRadian(): number {
    return this.heading * Math.PI / 180;
  }

  fixPrecision(p = 2): EndPointControl {
    super.fixPrecision(p);
    this.heading %= 360;
    if (this.heading < 0) this.heading += 360;
    this.heading = parseFloat(this.heading.toFixed(p));
    return this;
  }

  clone(): EndPointControl {
    return new EndPointControl(this.x, this.y, this.heading);
  }
}

// observable class
export class Spline implements CanvasEntity {
  @Type(() => Control, {
    discriminator: {
      property: '__type',
      subTypes: [
        { value: EndPointControl, name: 'end-point' },
        { value: Control, name: 'control' },
      ],
    },
    keepDiscriminatorProperty: true
  })
  public controls: (EndPointControl | Control)[];
  public uid: string;

  constructor(start: EndPointControl, middle: Control[], end: EndPointControl) {
    if (start === undefined) { // for serialization
      this.controls = [];
    } else {
      this.controls = [start, ...middle, end];
    }
    this.uid = makeId(10);
    makeAutoObservable(this);
  }

  distance(): number {
    let rtn = 0;

    const n = this.controls.length - 1;
    let prev: Vertex = this.controls[0];
    for (let t = 0; t <= 1; t += 0.05) {
      let point = new Vertex(0, 0);
      for (let i = 0; i <= n; i++) {
        const bernstein = this.bernstein(n, i, t);
        const controlPoint = this.controls[i];
        // PERFORMANCE: Do not use add() here
        point.x += controlPoint.x * bernstein;
        point.y += controlPoint.y * bernstein;
      }
      rtn += point.distance(prev);
      prev = point;
    }

    return rtn;
  }

  calculateKnots(gc: GeneralConfig, sc: SpeedConfig, integral = 0): Knot[] {
    // ALGO: Calculate the target interval based on the density of knots to generate knots more than enough
    const targetInterval = new UnitConverter(gc.uol, UnitOfLength.Centimeter).fromAtoB(gc.knotDensity) / 200;

    // The density of knots is NOT uniform along the curve
    let knots: Knot[] = this.calculateBezierCurveKnots(targetInterval, integral);

    if (knots.length > 1) knots[0].heading = this.first().heading;
    const lastKnot = knots[knots.length - 1];
    const lastControl = this.last();
    const distance = lastKnot.distance(lastControl);
    const integralDistance = lastKnot.integral + distance;
    const finalKnot = new Knot(lastControl.x, lastControl.y, distance, integralDistance, 0, this.last().heading);
    knots.push(finalKnot);

    const splineDeltaRatio = (1 / targetInterval) / ((integralDistance - integral) / gc.knotDensity);
    for (const knot of knots) {
      knot.delta *= splineDeltaRatio;
    }

    return knots;
  }

  first(): EndPointControl {
    return this.controls[0] as EndPointControl;
  }

  setFirst(point: EndPointControl): void {
    this.controls[0] = point;
  }

  last(): EndPointControl {
    return this.controls[this.controls.length - 1] as EndPointControl;
  }

  setLast(point: EndPointControl): void {
    this.controls[this.controls.length - 1] = point;
  }

  isLocked(): boolean {
    return this.controls.some((cp) => cp.lock);
  }

  isVisible(): boolean {
    return this.controls.some((cp) => cp.visible);
  }

  private calculateBezierCurveKnots(interval: number, integral = 0): Knot[] {
    let knots: Knot[] = [];

    // Bezier curve implementation
    let totalDistance = integral;
    let lastPoint: Vertex = this.controls[0];

    const n = this.controls.length - 1;
    for (let t = 0; t <= 1; t += interval) {
      let point = new Vertex(0, 0);
      for (let i = 0; i <= n; i++) {
        const bernstein = this.bernstein(n, i, t);
        const controlPoint = this.controls[i];
        // PERFORMANCE: Do not use add() here
        point.x += controlPoint.x * bernstein;
        point.y += controlPoint.y * bernstein;
      }
      let delta = point.distance(lastPoint);
      knots.push(new Knot(point.x, point.y, delta, totalDistance += delta));
      lastPoint = point;
    }

    return knots;
  }

  private bernstein(n: number, i: number, t: number): number {
    return this.binomial(n, i) * Math.pow(t, i) * Math.pow(1 - t, n - i);
  }

  private binomial(n: number, k: number): number {
    let coeff = 1;
    for (let i = n - k + 1; i <= n; i++) {
      coeff *= i;
    }
    for (let i = 1; i <= k; i++) {
      coeff /= i;
    }
    return coeff;
  }
}

// observable class
export class Path implements InteractiveEntity {
  @Type(() => Spline)
  public splines: Spline[];
  public name: string = "Path";
  public uid: string;
  public lock: boolean = false;
  public visible: boolean = true;

  @Exclude()
  public cachedKnots: Knot[] = [];

  constructor(firstSpline: Spline) {
    this.splines = [firstSpline];
    this.uid = makeId(10);
    makeAutoObservable(this);
  }

  getControlsSet(): (EndPointControl | Control)[] {
    let rtn: (EndPointControl | Control)[] = [];
    for (let i = 0; i < this.splines.length; i++) {
      let spline = this.splines[i];
      if (i === 0) rtn.push(spline.first());
      for (let j = 1; j < spline.controls.length; j++) {
        rtn.push(spline.controls[j]);
      }
    }
    return rtn;
  }

  addLine(end: EndPointControl): void {
    let spline;
    if (this.splines.length === 0) {
      spline = new Spline(new EndPointControl(0, 0, 0), [], end);
    } else {
      const last = this.splines[this.splines.length - 1];
      spline = new Spline(last.last(), [], end);
    }
    this.splines.push(spline);
  }

  add4ControlsCurve(p3: EndPointControl): void {
    let spline;
    if (this.splines.length === 0) {
      let p0 = new EndPointControl(0, 0, 0);
      let p1 = new Control(p0.x, p0.y + 24);
      let p2 = new Control(p3.x, p3.y - 24);
      spline = new Spline(p0, [p1, p2], p3);
    } else {
      const last = this.splines[this.splines.length - 1];
      let p0 = last.last();
      let c = last.controls.length < 4 ? last.controls[0] : last.controls[2];
      let p1 = p0.mirror(new Control(c.x, c.y));
      let p2 = p0.divide(new Control(2, 2)).add(p3.divide(new Control(2, 2)));

      spline = new Spline(p0, [p1, p2], p3);
    }
    this.splines.push(spline);
  }

  convertTo4ControlsCurve(spline: Spline) {
    let index = this.splines.indexOf(spline);
    let found = index !== -1;
    if (!found) return;

    let prev: Spline | null = null;
    if (index > 0) {
      prev = this.splines[index - 1];
    }

    let next: Spline | null = null;
    if (index + 1 < this.splines.length) {
      next = this.splines[index + 1];
    }

    let p0 = spline.first();
    let p3 = spline.last();

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

    spline.controls = [p0, p1, p2, p3];
  }

  convertToLine(spline: Spline) {
    spline.controls.splice(1, spline.controls.length - 2);
  }

  splitSpline(spline: Spline, point: EndPointControl): void {
    let index = this.splines.indexOf(spline);
    let found = index !== -1;
    if (!found) return;

    let cp_count = spline.controls.length;
    if (cp_count === 2) {
      let last = spline.last();
      spline.setLast(point);
      let new_spline = new Spline(point, [], last);
      this.splines.splice(index + 1, 0, new_spline);
    } else if (cp_count === 4) {
      let p0 = spline.controls[0] as EndPointControl;
      let p1 = spline.controls[1];
      let p2 = spline.controls[2];
      let p3 = spline.controls[3] as EndPointControl;

      let a = p1.divide(new Control(2, 2)).add(point.divide(new Control(2, 2)));
      let b = point;
      let c = p2.divide(new Control(2, 2)).add(point.divide(new Control(2, 2)));
      spline.controls = [p0, p1, a, b];
      let new_spline = new Spline(b, [c, p2], p3);
      this.splines.splice(index + 1, 0, new_spline);
    }
  }

  removeSpline(point: EndPointControl): (EndPointControl | Control)[] {
    for (let i = 0; i < this.splines.length; i++) {
      let spline = this.splines[i];
      if (spline.first() === point) { // pointer comparison
        if (i > 0) {
          let prev = this.splines[i - 1];
          prev.setLast(spline.last()); // pointer assignment
        }
        this.splines.splice(i, 1);
      } else if (i + 1 === this.splines.length && spline.last() === point) { // pointer comparison
        this.splines.splice(i, 1);
      } else {
        continue;
      }

      let removedControls = [...spline.controls];
      if (i > 0) {
        removedControls.splice(0, 1); // keep the first control
      }
      if (i + 1 < this.splines.length) {
        removedControls.splice(removedControls.length - 1, 1); // keep the last control
      }
      return removedControls;
    }
    return [];
  }

  calculateKnots(gc: GeneralConfig, sc: SpeedConfig): Knot[] {
    // ALGO: The density of knots is NOT uniform along the curve, and we are using this to decelerate the robot
    const gen1: Knot[] = [];
    let pathTTD = 0; // total travel distance
    for (let spline of this.splines) {
      const [firstKnot, ...knots] = spline.calculateKnots(gc, sc, pathTTD);
      // ALGO: Ignore the first knot, it is (too close) the last knot of the previous spline
      if (pathTTD === 0) gen1.push(firstKnot); // Except for the first spline
      gen1.push(...knots);
      pathTTD = gen1[gen1.length - 1].integral;
    }

    // ALGO: gen1 must have at least 2 knots, if not return gen1 with no knot at all, or 1 knot with speed 0 and heading
    if (gen1.length < 2) return this.cachedKnots = gen1;

    const speedDiff = sc.speedLimit.to - sc.speedLimit.from;
    const applicationDiff = sc.applicationRange.to - sc.applicationRange.from;
    const useRatio = speedDiff !== 0 && applicationDiff !== 0;
    const applicationRatio = speedDiff / applicationDiff;
    const accelThreshold = sc.transitionRange.from * pathTTD;
    const decThreshold = sc.transitionRange.to * pathTTD;
    // ALGO: accelSpeedScale can be Infinity if sc.transitionRange.from is 0, but it is ok
    const accelSpeedScale = speedDiff / sc.transitionRange.from;
    // ALGO: Same with above
    const decSpeedScale = speedDiff / (1 - sc.transitionRange.to);

    const targetInterval = 1 / (pathTTD / gc.knotDensity);

    function calculateSpeed(p3: Knot) {
      // ALGO: Scale the speed according to the application range
      // ALGO: The first knot has delta 0, but it should have the highest speed
      const delta = p3.delta;
      if (delta < sc.applicationRange.from && delta !== 0) p3.speed = sc.speedLimit.from;
      else if (delta > sc.applicationRange.to) p3.speed = sc.speedLimit.to;
      else if (useRatio && delta !== 0) p3.speed = sc.speedLimit.from + (delta - sc.applicationRange.from) * applicationRatio;
      else p3.speed = sc.speedLimit.to;

      // ALGO: Acceleration/Deceleration
      // ALGO: Speed never exceeds the speed limit, except for the final knot
      // (p3.integral / totalDistance) / sc.transitionRange.from * speedDiff
      if (p3.integral < accelThreshold) p3.speed = Math.min(p3.speed, sc.speedLimit.from + (p3.integral / pathTTD) * accelSpeedScale);
      else if (p3.integral > decThreshold) p3.speed = Math.min(p3.speed, sc.speedLimit.from + (1 - p3.integral / pathTTD) * decSpeedScale);

      return p3;
    }

    // ALGO: Space points evenly
    const gen2: Knot[] = [];
    let closestIdx = 1;

    for (let t = 0; t < 1; t += targetInterval) {
      const integral = t * pathTTD;

      let heading: number | undefined;
      while (gen1[closestIdx].integral < integral) { // ALGO: ClosestIdx never exceeds the array length
        // ALGO: Obtain the heading value if it is available
        if (gen1[closestIdx].heading !== undefined) heading = gen1[closestIdx].heading;
        closestIdx++;
      }

      const p1 = gen1[closestIdx - 1];
      const p2 = gen1[closestIdx];
      const pRatio = (integral - p1.integral) / (p2.integral - p1.integral);
      const p3X = p1.x + (p2.x - p1.x) * pRatio;
      const p3Y = p1.y + (p2.y - p1.y) * pRatio;
      const p3Delta = p1.delta + (p2.delta - p1.delta) * pRatio;
      const p3 = new Knot(p3X, p3Y, p3Delta, integral, 0, heading);

      gen2.push(calculateSpeed(p3));
    }

    // ALGO: gen2 must have at least 1 knots
    // ALGO: The first should have heading information
    gen2[0].heading = gen1[0].heading;

    // ALGO: The final knot should be the last end control point in the path
    // ALGO: At this point, we know splines has at least 1 spline
    const lastControl = this.splines[this.splines.length - 1].last();
    // ALGO: No need to calculate delta and integral for the final knot, it is always 0
    const finalKnot = new Knot(lastControl.x, lastControl.y, 0, 0, 0, lastControl.heading);
    // ALGO: No need to calculate speed for the final knot, it is always 0
    gen2.push(finalKnot);

    return this.cachedKnots = gen2;
  }
}