import { Member } from '@/types/Family';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

interface MiniMapProps {
  members: Member[];
  positions: Record<string, { x: number; y: number }>;
  edges: { from: string; to: string; isJoint?: boolean; parent2?: string }[];
  spouseEdges: { from: string; to: string }[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
    width: number;
    height: number;
  };
  contentSize: {
    width: number;
    height: number;
  };
  onMapPress?: (x: number, y: number) => void;
  tintColor: string;
}

export const MiniMap: React.FC<MiniMapProps> = ({
  members,
  positions,
  edges,
  spouseEdges,
  viewport,
  contentSize,
  onMapPress,
  tintColor,
}) => {
  const MAP_SIZE = 150;
  const padding = 10;

  const { scale, offsetX, offsetY, mapWidth, mapHeight } = useMemo(() => {
    const availableWidth = MAP_SIZE - padding * 2;
    const availableHeight = MAP_SIZE - padding * 2;
    
    const contentRatio = contentSize.width / contentSize.height;
    let mapW, mapH;
    
    if (contentRatio > 1) {
      mapW = availableWidth;
      mapH = availableWidth / contentRatio;
    } else {
      mapH = availableHeight;
      mapW = availableHeight * contentRatio;
    }

    const s = mapW / contentSize.width;
    
    return {
      scale: s,
      offsetX: (MAP_SIZE - mapW) / 2,
      offsetY: (MAP_SIZE - mapH) / 2,
      mapWidth: mapW,
      mapHeight: mapH,
    };
  }, [contentSize, MAP_SIZE]);

  const handlePress = (event: any) => {
    if (!onMapPress) return;
    const { locationX, locationY } = event.nativeEvent;
    
    // Convert map coordinates back to content coordinates
    const contentX = (locationX - offsetX) / scale;
    const contentY = (locationY - offsetY) / scale;
    
    onMapPress(contentX, contentY);
  };

  const viewportRect = useMemo(() => {
    return {
      x: offsetX + viewport.x * scale,
      y: offsetY + viewport.y * scale,
      width: (viewport.width / viewport.zoom) * scale,
      height: (viewport.height / viewport.zoom) * scale,
    };
  }, [viewport, scale, offsetX, offsetY]);

  return (
    <View style={[styles.container, { width: MAP_SIZE, height: MAP_SIZE }]}>
      <Pressable onPress={handlePress} style={StyleSheet.absoluteFill}>
        <Svg width={MAP_SIZE} height={MAP_SIZE}>
          {/* Background */}
          <Rect
            x={offsetX}
            y={offsetY}
            width={mapWidth}
            height={mapHeight}
            fill="rgba(0,0,0,0.05)"
            rx={4}
          />

          {/* Edges */}
          {edges.map((edge, i) => {
            const from = positions[edge.from];
            const to = positions[edge.to];
            if (!from || !to) return null;
            return (
              <Line
                key={`edge-${i}`}
                x1={offsetX + from.x * scale}
                y1={offsetY + from.y * scale}
                x2={offsetX + to.x * scale}
                y2={offsetY + to.y * scale}
                stroke="#cbd5e1"
                strokeWidth={1}
              />
            );
          })}

          {/* Spouse Edges */}
          {spouseEdges.map((edge, i) => {
            const from = positions[edge.from];
            const to = positions[edge.to];
            if (!from || !to) return null;
            return (
              <Line
                key={`spouse-${i}`}
                x1={offsetX + from.x * scale}
                y1={offsetY + from.y * scale}
                x2={offsetX + to.x * scale}
                y2={offsetY + to.y * scale}
                stroke={tintColor}
                strokeWidth={1}
                strokeDasharray="2,2"
              />
            );
          })}

          {/* Nodes */}
          {members.map((member) => {
            const pos = positions[member.id];
            if (!pos) return null;
            return (
              <Circle
                key={member.id}
                cx={offsetX + pos.x * scale}
                cy={offsetY + pos.y * scale}
                r={2}
                fill={member.sex === 'Female' ? '#f472b6' : member.sex === 'Male' ? '#60a5fa' : '#94a3b8'}
              />
            );
          })}

          {/* Viewport Indicator */}
          <Rect
            x={viewportRect.x}
            y={viewportRect.y}
            width={viewportRect.width}
            height={viewportRect.height}
            stroke={tintColor}
            strokeWidth={1.5}
            fill="rgba(0,0,0,0.05)"
          />
        </Svg>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 150,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    overflow: 'hidden',
  },
});
