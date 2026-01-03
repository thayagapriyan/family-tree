import React, { useCallback } from 'react';
import { View } from 'react-native';
import {
    Gesture,
    GestureDetector,
    GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
    runOnJS,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

interface ZoomPanContainerProps {
  children: React.ReactNode;
  contentWidth: number;
  contentHeight: number;
  containerWidth: number;
  containerHeight: number;
  minZoom?: number;
  maxZoom?: number;
  onZoomChange?: (zoom: number) => void;
  onTransform?: (x: number, y: number, zoom: number) => void;
  initialFocusX?: number;
  initialFocusY?: number;
}

interface ZoomPanContainerHandle {
  reset: () => void;
  focusOn: (x: number, y: number, zoom?: number) => void;
}

export const ZoomPanContainer = React.forwardRef<ZoomPanContainerHandle, ZoomPanContainerProps>(
  (
    {
      children,
      contentWidth,
      contentHeight,
      containerWidth,
      containerHeight,
      minZoom = 0.5,
      maxZoom = 3,
      onZoomChange,
      onTransform,
      initialFocusX,
      initialFocusY,
    },
    ref
  ) => {
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);

    const focusOn = useCallback((x: number, y: number, zoom: number = 1) => {
      // Calculate translation to center the point (x, y) in the container
      // The content is centered by default at (0,0) in the animated view.
      // We need to move the content so that (x, y) is at the center of the container.
      const targetX = (containerWidth / 2 - x) * zoom;
      const targetY = (containerHeight / 2 - y) * zoom;

      scale.value = withSpring(zoom);
      translateX.value = withSpring(targetX);
      translateY.value = withSpring(targetY);
      
      savedScale.value = zoom;
      savedTranslateX.value = targetX;
      savedTranslateY.value = targetY;

      if (onZoomChange) {
        onZoomChange(zoom);
      }
    }, [containerWidth, containerHeight, scale, translateX, translateY, savedScale, savedTranslateX, savedTranslateY, onZoomChange]);

    const resetZoomPan = useCallback(() => {
      if (initialFocusX !== undefined && initialFocusY !== undefined) {
        focusOn(initialFocusX, initialFocusY, 0.5);
      } else {
        scale.value = withSpring(1);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        if (onZoomChange) {
          onZoomChange(1);
        }
      }
    }, [initialFocusX, initialFocusY, focusOn, scale, translateX, translateY, savedScale, savedTranslateX, savedTranslateY, onZoomChange]);

    React.useImperativeHandle(ref, () => ({ 
      reset: resetZoomPan,
      focusOn: focusOn
    }), [resetZoomPan, focusOn]);

    const clampPan = (x: number, y: number, currentScale: number) => {
      'worklet';
      const scaledWidth = contentWidth * currentScale;
      const scaledHeight = contentHeight * currentScale;

      // Allow panning to see the entire content.
      // We use a very large bound to ensure the user can always drag any part of the tree into view.
      // This effectively removes the "wall" you were hitting.
      const boundX = Math.max(containerWidth, scaledWidth) * 2;
      const boundY = Math.max(containerHeight, scaledHeight) * 2;

      return {
        clampedX: Math.max(-boundX, Math.min(boundX, x)),
        clampedY: Math.max(-boundY, Math.min(boundY, y)),
      };
    };

    const pinchGesture = Gesture.Pinch()
      .onUpdate((event) => {
        const nextScale = savedScale.value * event.scale;
        scale.value = Math.max(minZoom, Math.min(maxZoom, nextScale));
      })
      .onEnd(() => {
        savedScale.value = scale.value;
        if (onZoomChange) {
          runOnJS(onZoomChange)(scale.value);
        }
      });

    const panGesture = Gesture.Pan()
      .onUpdate((event) => {
        const { clampedX, clampedY } = clampPan(
          savedTranslateX.value + event.translationX,
          savedTranslateY.value + event.translationY,
          scale.value
        );
        translateX.value = clampedX;
        translateY.value = clampedY;
      })
      .onEnd(() => {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      });

    const doubleTapGesture = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        'worklet';
        if (initialFocusX !== undefined && initialFocusY !== undefined) {
          runOnJS(focusOn)(initialFocusX, initialFocusY, 0.5);
        } else {
          // Toggle logic: if already zoomed in/out, reset to 1. Otherwise zoom to 2.
          const isZoomed = Math.abs(scale.value - 1) > 0.01;
          
          if (isZoomed) {
            scale.value = withSpring(1);
            translateX.value = withSpring(0);
            translateY.value = withSpring(0);
            savedScale.value = 1;
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
            if (onZoomChange) {
              runOnJS(onZoomChange)(1);
            }
          } else {
            const targetScale = 2;
            scale.value = withSpring(targetScale);
            // Keep translation at 0 to zoom into the center
            savedScale.value = targetScale;
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
            if (onZoomChange) {
              runOnJS(onZoomChange)(targetScale);
            }
          }
        }
      });

    const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture);

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    }));

    // Track transform changes to update MiniMap
    useAnimatedReaction(
      () => ({
        x: translateX.value,
        y: translateY.value,
        s: scale.value,
      }),
      (current) => {
        if (onTransform) {
          runOnJS(onTransform)(current.x, current.y, current.s);
        }
      },
      [onTransform]
    );

    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <GestureDetector gesture={composedGesture}>
          <View
            style={{
              flex: 1,
              overflow: 'hidden',
            }}
          >
            <Animated.View style={[{ flex: 1 }, animatedStyle]}>
              <View style={{ width: contentWidth, height: contentHeight }}>
                {children}
              </View>
            </Animated.View>
          </View>
        </GestureDetector>
      </GestureHandlerRootView>
    );
  }
);

ZoomPanContainer.displayName = 'ZoomPanContainer';
