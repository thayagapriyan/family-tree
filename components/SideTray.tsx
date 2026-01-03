import { useThemeColor } from '@/hooks/useThemeColor';
import { Ionicons } from '@expo/vector-icons';
import React, { memo, useEffect, useState } from 'react';
import {
    Pressable,
    StyleSheet,
    useWindowDimensions,
    View
} from 'react-native';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './ThemedText';

interface SideTrayProps {
  isOpen: boolean;
  onClose: () => void;
  side: 'left' | 'right';
  title?: string;
  children: React.ReactNode;
}

export const SideTray = memo(({ isOpen, onClose, side, title, children }: SideTrayProps) => {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLargeScreen = width > 768;
  const trayWidth = isLargeScreen ? 350 : width * 0.85;
  
  const [isRendered, setIsRendered] = useState(isOpen);
  const translateX = useSharedValue(side === 'left' ? -trayWidth : trayWidth);
  const opacity = useSharedValue(0);

  const bgColor = useThemeColor({}, 'background');
  const borderColor = useThemeColor({}, 'border');
  const textColor = useThemeColor({}, 'text');

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      translateX.value = withSpring(0, { 
        damping: 25, 
        stiffness: 120,
        mass: 0.8,
      });
      opacity.value = withTiming(1, { duration: 300 });
    } else {
      translateX.value = withSpring(
        side === 'left' ? -trayWidth : trayWidth, 
        { damping: 25, stiffness: 120, mass: 0.8 },
        (finished) => {
          if (finished) {
            runOnJS(setIsRendered)(false);
          }
        }
      );
      opacity.value = withTiming(0, { duration: 250 });
    }
  }, [isOpen, trayWidth, side]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
    };
  });

  const backdropStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
    };
  });

  if (!isRendered && !isOpen) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000, pointerEvents: 'box-none' }]}>
      {/* Backdrop */}
      <Animated.View 
        style={[
          styles.backdrop, 
          backdropStyle,
          { pointerEvents: isOpen ? 'auto' : 'none' }
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Tray */}
      <Animated.View
        style={[
          styles.tray,
          {
            width: trayWidth,
            backgroundColor: bgColor,
            borderLeftWidth: side === 'right' ? 1 : 0,
            borderRightWidth: side === 'left' ? 1 : 0,
            borderColor: borderColor,
            [side]: 0,
          },
          animatedStyle,
        ]}
      >
        <View style={[styles.header, { borderBottomColor: borderColor, paddingTop: Math.max(insets.top, 16) }]}>
          <View style={styles.headerTitleRow}>
            {side === 'right' && <View style={styles.grabber} />}
            <ThemedText style={styles.title}>{title}</ThemedText>
            {side === 'left' && <View style={styles.grabber} />}
          </View>
          <Pressable onPress={onClose} hitSlop={15} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={textColor} />
          </Pressable>
        </View>
        <View style={styles.content}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  tray: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 20,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  grabber: {
    width: 4,
    height: 20,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    opacity: 0.5,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
});
