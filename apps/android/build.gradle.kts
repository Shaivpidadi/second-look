// Shared build config lives in gradle/libs.versions.toml and the
// module build files. Nothing to do at the root.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.jvm) apply false
}
