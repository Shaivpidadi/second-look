plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    compilerOptions {
        // Any JDK 17+ runs the build; bytecode stays on 17.
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    implementation(libs.coroutines.core)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.junit)
}

tasks.withType<Test> {
    useJUnit()
}
