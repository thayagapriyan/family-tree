import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Platform, Pressable, StyleSheet, View } from 'react-native';

interface FeatureTooltipProps {
  visible: boolean;
  title: string;
  message: string;
  onDismiss: () => void;
  position?: 'top' | 'bottom' | 'center';
}

export function FeatureTooltip({ visible, title, message, onDismiss, position = 'center' }: FeatureTooltipProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    }
  }, [visible, fadeAnim, scaleAnim]);

  if (!visible) return null;

  const { height } = Dimensions.get('window');
  const topOffset = position === 'top' ? 120 : position === 'bottom' ? height - 280 : undefined;

  return (
    <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      <Animated.View 
        style={[
          styles.tooltipCard, 
          { transform: [{ scale: scaleAnim }] },
          topOffset !== undefined && { position: 'absolute', top: topOffset, left: 24, right: 24 }
        ]}
      >
        <View style={styles.iconContainer}>
          <Ionicons name="git-branch" size={28} color="#5856D6" />
        </View>
        <ThemedText style={styles.title}>{title}</ThemedText>
        <ThemedText style={styles.message}>{message}</ThemedText>
        <View style={styles.tipBadge}>
          <Ionicons name="bulb-outline" size={14} color="#f59e0b" />
          <ThemedText style={styles.tipText}>Pro Tip</ThemedText>
        </View>
        <Pressable onPress={onDismiss} style={styles.dismissBtn}>
          <ThemedText style={styles.dismissText}>Got it!</ThemedText>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  tooltipCard: {
    width: '85%',
    maxWidth: 340,
    backgroundColor: '#1e293b',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    ...Platform.select({
      web: { boxShadow: '0 25px 60px rgba(0,0,0,0.4)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.4, shadowRadius: 30, elevation: 20 }
    }),
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#5856D620',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  tipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f59e0b15',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 20,
  },
  tipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f59e0b',
  },
  dismissBtn: {
    backgroundColor: '#5856D6',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 16,
    ...Platform.select({
      web: { boxShadow: '0 8px 20px rgba(88, 86, 214, 0.4)' },
      default: { shadowColor: '#5856D6', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12 }
    }),
  },
  dismissText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
});
