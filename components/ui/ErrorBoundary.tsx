/**
 * components/ui/ErrorBoundary.tsx — React Error Boundary
 *
 * Catches JavaScript errors anywhere in the component tree below,
 * logs them, and renders a fallback UI instead of crashing the entire app.
 *
 * Usage:
 *   <ErrorBoundary fallback={<Text>Something went wrong</Text>}>
 *     <MyFeature />
 *   </ErrorBoundary>
 *
 *   // With reset button:
 *   <ErrorBoundary showReset module="Creator Studio">
 *     <CreatorStudio />
 *   </ErrorBoundary>
 *
 * IMPORTANT: Must be a class component — React does not yet support
 * error boundaries as function components.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface Props {
  children:   React.ReactNode;
  /** Custom fallback element shown on error. If provided, overrides default UI. */
  fallback?:  React.ReactNode;
  /** Show a "retry" button in the default fallback UI. Default: true. */
  showReset?: boolean;
  /** Module name displayed in the error UI. */
  module?:    string;
  /** Called when an error is caught (e.g., for analytics/logging). */
  onError?:   (error: Error, info: React.ErrorInfo) => void;
}

interface State {
  hasError:   boolean;
  error?:     Error;
  errorInfo?: React.ErrorInfo;
}

export class ErrorBoundary extends React.Component<Props, State> {
  static defaultProps = { showReset: true };

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const mod = this.props.module ?? 'Unknown';
    console.error(`[ErrorBoundary] Caught in module "${mod}":`, error.message);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render(): React.ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, showReset, module: mod } = this.props;

    if (!hasError) return children;
    if (fallback)  return fallback;

    return (
      <View style={s.container}>
        <MaterialCommunityIcons name="alert-circle-outline" size={48} color="#FF3B3B" />
        <Text style={s.title}>
          {mod ? `Error en ${mod}` : 'Error inesperado'}
        </Text>
        <Text style={s.msg} numberOfLines={3}>
          {'Algo salió mal. Por favor intenta de nuevo.'}
        </Text>
        {showReset && (
          <Pressable style={s.btn} onPress={this.reset}>
            <Text style={s.btnText}>Reintentar</Text>
          </Pressable>
        )}
      </View>
    );
  }
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    alignItems:      'center',
    justifyContent:  'center',
    padding:         32,
    backgroundColor: '#0A0A0F',
    gap:             12,
  },
  title: {
    color:      '#fff',
    fontSize:   18,
    fontWeight: '700',
    textAlign:  'center',
  },
  msg: {
    color:      'rgba(255,255,255,0.5)',
    fontSize:   13,
    textAlign:  'center',
    lineHeight: 20,
  },
  btn: {
    marginTop:       8,
    backgroundColor: '#7C5CFF',
    borderRadius:    12,
    paddingHorizontal: 28,
    paddingVertical:   12,
  },
  btnText: {
    color:      '#fff',
    fontSize:   15,
    fontWeight: '600',
  },
});
