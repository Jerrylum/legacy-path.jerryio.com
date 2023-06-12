import { action } from "mobx"
import { observer } from "mobx-react-lite";
import Konva from 'konva';
import { Line } from 'react-konva';
import { EndPointControl, SplineVariant } from '../types/Path';
import { SplineElementProps } from "./SplineElement";
import { ConvertSpline, SplitSpline } from "../types/Command";

const SplinePointsHitBoxElement = observer((props: SplineElementProps) => {
  function onLineClick(event: Konva.KonvaEventObject<MouseEvent>) {
    const evt = event.evt;

    // UX: Do not interact with spline if any of its control points or the path is locked
    const isLocked = props.spline.isLocked() || props.path.lock;
    if (isLocked) {
      evt.preventDefault();
      return;
    }

    let cpInPx = new EndPointControl(evt.offsetX, evt.offsetY, 0);
    let cpInUOL = props.cc.toUOL(cpInPx);

    if (evt.button === 2) { // right click
      // UX: Split spline if: right click
      props.app.history.execute(`Split spline ${props.spline.uid} with control ${cpInUOL.uid}`,
        new SplitSpline(props.path, props.spline, cpInUOL));
    } else if (evt.button === 0) {
      // UX: Convert spline if: left click
      if (props.spline.controls.length === 2)
        props.app.history.execute(`Convert spline ${props.spline.uid} to curve`,
          new ConvertSpline(props.path, props.spline, SplineVariant.CURVE));
      else
        props.app.history.execute(`Convert spline ${props.spline.uid} to line`,
          new ConvertSpline(props.path, props.spline, SplineVariant.LINEAR));
    }
  }

  let points: number[] = [];

  for (let cp of props.spline.controls) {
    let cpInPx = props.cc.toPx(cp);
    points.push(cpInPx.x);
    points.push(cpInPx.y);
  }

  const pointWidth = props.cc.pixelWidth / 320 * 8;

  return (
    <Line points={points} strokeWidth={pointWidth} stroke={"red"} opacity={0} bezier={props.spline.controls.length > 2} onClick={action(onLineClick)} />
  )
});

export { SplinePointsHitBoxElement };
