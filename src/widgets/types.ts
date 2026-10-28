import type React from 'react';
import type { WidgetSize } from '../store';
import type { ToolKey } from '../tools';

/** What every widget on Today's board is given. */
export interface WidgetProps {
  /** the widget's id on the board */
  id: string;
  size: WidgetSize;
  /** its own settings (the subject a trend follows, say) */
  config?: Record<string, unknown>;
  /** the board is being edited: the widget shows itself but takes no touches */
  editing: boolean;
  /** drawn in the gallery: live, scaled down, and never pressed */
  preview: boolean;
  /** keeps a change to the widget's own settings on the board */
  setConfig: (patch: Record<string, unknown>) => void;
}

/** A kind of widget, as the board and the gallery know it. */
export interface WidgetDef {
  type: string;
  /** the tool it belongs to: archived, the widget is not shown (null: the app's own, shown always) */
  tool: ToolKey | null;
  /** its name in the gallery and to a screen reader while editing */
  title: string;
  /** a line in the gallery: what it is for */
  desc: string;
  /** the sizes it comes in, the first its default */
  sizes: readonly WidgetSize[];
  /**
   * Today's own sections, which take the height of what they hold (the list, quick access): full width, one of each on
   * the board, and drawn as they have always been. The others are tiles of a fixed size.
   */
  flow?: boolean;
  /** it has a hold of its own (a row's menu, a tile's drag), so holding it does not start editing the board */
  ownHold?: boolean;
  Component: React.ComponentType<WidgetProps>;
}
