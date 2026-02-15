import { AreaClosed } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { scaleLinear } from "@visx/scale";
import { LinearGradient } from "@visx/gradient";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";

type SparklineAreaProps = {
  data: number[];
  color: string;
  id?: string;
};

function SparklineInner({
  data,
  color,
  id = "sparkline",
  width,
  height,
}: SparklineAreaProps & { width: number; height: number }) {
  if (width < 2 || height < 2 || data.length < 2) return null;

  const padding = 2;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  const xScale = scaleLinear({
    domain: [0, data.length - 1],
    range: [0, innerWidth],
  });

  const maxVal = Math.max(...data, 1);
  const yScale = scaleLinear({
    domain: [0, maxVal],
    range: [innerHeight, 0],
  });

  const gradientId = `gradient-${id}`;

  return (
    <svg width={width} height={height}>
      <LinearGradient
        id={gradientId}
        from={color}
        to={color}
        fromOpacity={0.3}
        toOpacity={0.02}
      />
      <Group left={padding} top={padding}>
        <AreaClosed
          data={data}
          x={(_, i) => xScale(i)}
          y={(d) => yScale(d)}
          yScale={yScale}
          curve={curveMonotoneX}
          fill={`url(#${gradientId})`}
          stroke={color}
          strokeWidth={1.5}
        />
      </Group>
    </svg>
  );
}

export function SparklineArea(props: SparklineAreaProps) {
  return (
    <ParentSize debounceTime={50}>
      {({ width, height }) => (
        <SparklineInner {...props} width={width} height={height} />
      )}
    </ParentSize>
  );
}
