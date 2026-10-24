package expo.modules.apprestart

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Restarts the app's process: the launcher activity is started again in a fresh task and this process ends, so the
 * next launch reads everything anew (Sturoids switches profiles this way). Returns false when there is nothing to
 * start, and the process keeps running.
 */
class AppRestartModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppRestart")

    Function("restart") {
      val context = appContext.reactContext ?: return@Function false
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return@Function false
      val component = launch.component ?: return@Function false
      val restart = Intent.makeRestartActivityTask(component)
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.startActivity(restart)
      } else {
        restart.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.applicationContext.startActivity(restart)
      }
      Runtime.getRuntime().exit(0)
      true
    }
  }
}
