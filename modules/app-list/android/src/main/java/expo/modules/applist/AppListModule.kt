package expo.modules.applist

import android.content.Intent
import android.content.pm.PackageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AppListModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppList")

    // AsyncFunction: the package manager query runs on the modules queue, never on the JS thread
    AsyncFunction("getInstalledApps") {
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, String>>()
      val pm = context.packageManager
      val intent = Intent(Intent.ACTION_MAIN, null).apply {
        addCategory(Intent.CATEGORY_LAUNCHER)
      }
      // MATCH_ALL so the complete launcher set is returned (QUERY_ALL_PACKAGES is granted)
      val activities = pm.queryIntentActivities(intent, PackageManager.MATCH_ALL)
      activities
        .map {
          mapOf(
            "label" to it.loadLabel(pm).toString(),
            "packageName" to it.activityInfo.packageName
          )
        }
        .distinctBy { it["packageName"] }
        .filter { it["packageName"] != context.packageName }
        .sortedBy { (it["label"] ?: "").lowercase() }
    }
  }
}
