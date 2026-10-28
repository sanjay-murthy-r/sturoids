// react-native-android-widget on the PC version: there is no home screen to draw widgets on.
const Nothing = (_p: any) => null;
export const FlexWidget = Nothing;
export const TextWidget = Nothing;
export const SvgWidget = Nothing;
export const ImageWidget = Nothing;
export const OverlapWidget = Nothing;
export const IconWidget = Nothing;
export const ListWidget = Nothing;
export const WidgetPreview = Nothing;
export const registerWidgetTaskHandler = (_h: any) => {};
export const registerWidgetConfigurationScreen = (_s: any) => {};
export const requestWidgetUpdate = async (_o: any) => {};
export const requestWidgetUpdateById = async (_o: any) => {};
export const getWidgetInfo = async (_n: string) => [] as { widgetId: number; width: number; height: number }[];
export type WidgetTaskHandlerProps = any;
export type ColorProp = string;
