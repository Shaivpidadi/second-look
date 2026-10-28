import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

val localProperties = Properties()
val localFile = rootProject.file("local.properties")
if (localFile.exists()) {
    localFile.inputStream().use(localProperties::load)
}
// Dev-mode builds run with 0/0 credentials (see docs/ANDROID.md);
// real values come from local.properties and are never committed.
val datAppId: String = localProperties.getProperty("mwdat.applicationId", "0")
val datClientToken: String = localProperties.getProperty("mwdat.clientToken", "0")

android {
    namespace = "com.secondlook.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.secondlook.android"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        manifestPlaceholders["mwdat_application_id"] = datAppId
        manifestPlaceholders["mwdat_client_token"] = datClientToken
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.mwdat.core)
    implementation(libs.mwdat.camera)
    debugImplementation(libs.mwdat.mockdevice)
    implementation(libs.coroutines.core)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.lifecycle.runtime)
    implementation(libs.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
}
