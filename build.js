#!/usr/bin/env node

/**
 * Modern build script for Zoho Embedded App SDK
 * Creates the supported bundles:
 * 1. ZohoEmbededAppSDK.min.js - ZSDK + Initialization + ZRC + ZohoCrmHelper
 * 2. wdk.min.js - ZSDK + Initialization + ZRC + WDK
 * 3. wdk_lite.min.js - ZSDK + Initialization + ZRC + WDKLite
 * 4. WApp.min.js - ZSDK + Initialization + ZRC + WAppHelper
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { minify } = require('terser');

const BUILD_DIR = path.join(__dirname, 'build', 'js');
const LIB_DIR = path.join(__dirname, 'lib');
const TEMP_DIR = path.join(__dirname, 'build', 'temp');

// Ensure directories exist
[BUILD_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// File order for ZohoEmbededAppSDK bundle
const ZOHO_FILES = [
  'ZSDK.js',
  'Initialization.js',
  'ZRC.js',
  'ZohoCrmHelper.js',
  'Event.js',
  'Store.js',
  'WDK.js'
];

// File order for WDK bundle
const WDK_FILES = [
  'ZSDK.js',
  'Initialization.js',
  'ZRC.js',
  'WDK.js'
];

// File order for WApp bundle
const WAPP_FILES = [
  'ZSDK.js',
  'Initialization.js',
  'ZRC.js',
  'WAppHelper.js'
];

// File order for WDKLite bundle
const WDKLITE_FILES = [
  'ZSDK.js',
  'Initialization.js',
  'ZRC.js',
  'WDKLite.js'
];

/**
 * Transpile a file using Babel
 */
function transpileFile(inputFile, outputFile, configFile = '.babelrc') {
  const configPath = path.join(__dirname, configFile);
  const command = `npx babel "${inputFile}" --out-file "${outputFile}" --config-file "${configPath}"`;
  
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✓ Transpiled: ${path.basename(inputFile)}`);
  } catch (error) {
    console.error(`✗ Failed to transpile ${inputFile}:`, error.message);
    process.exit(1);
  }
}

/**
 * Concatenate files
 */
function concatenateFiles(files, outputFile) {
  const contents = files.map(file => {
    const filePath = path.join(TEMP_DIR, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf8');
  });
  
  const concatenated = contents.join('\n\n');
  fs.writeFileSync(outputFile, concatenated, 'utf8');
  console.log(`✓ Concatenated ${files.length} files`);
  return concatenated;
}

/**
 * Minify JavaScript using Terser
 */
async function minifyFile(inputFile, outputFile, options = {}) {
  const code = fs.readFileSync(inputFile, 'utf8');
  
  const terserOptions = {
    compress: {
      drop_console: false,
      drop_debugger: true,
      passes: 2,
      ...options.compress
    },
    mangle: {
      reserved: ['ZSDK', 'ZOHO', 'ZDK', 'ZSDKUtil', 'ZSDKMessageManager', 'ZSDKEventManager', 'wdk', 'WApp', 'embeddedApp'],
      ...options.mangle
    },
    format: {
      comments: false,
      ...options.format
    },
    ...options
  };
  
  try {
    const result = await minify(code, terserOptions);
    
    if (result.error) {
      throw result.error;
    }
    
    fs.writeFileSync(outputFile, result.code, 'utf8');
    
    const originalSize = fs.statSync(inputFile).size;
    const minifiedSize = fs.statSync(outputFile).size;
    const reduction = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
    
    console.log(`✓ Minified: ${path.basename(outputFile)}`);
    console.log(`  Original: ${(originalSize / 1024).toFixed(2)} KB`);
    console.log(`  Minified: ${(minifiedSize / 1024).toFixed(2)} KB`);
    console.log(`  Reduction: ${reduction}%`);
    
    return result.code;
  } catch (error) {
    console.error(`✗ Minification failed:`, error.message);
    process.exit(1);
  }
}

/**
 * Build ZohoEmbededAppSDK bundle
 */
async function buildZohoEmbededAppSDK() {
  console.log('\n📦 Building ZohoEmbededAppSDK.min.js bundle...\n');

  // Step 1: Transpile files
  console.log('Step 1: Transpiling files...');
  ZOHO_FILES.forEach((file) => {
    const inputFile = path.join(LIB_DIR, file);
    const outputFile = path.join(TEMP_DIR, file);

    const configFile = file === 'ZSDK.js' ? '.babelrc' : '.babelrc.modern.json';
    transpileFile(inputFile, outputFile, configFile);
  });

  // Step 2: Concatenate
  console.log('\nStep 2: Concatenating files...');
  const concatFile = path.join(TEMP_DIR, 'ZohoEmbededAppSDK.concat.js');
  concatenateFiles(ZOHO_FILES, concatFile);

  // Step 3: Minify
  console.log('\nStep 3: Minifying...');
  const outputFile = path.join(BUILD_DIR, 'ZohoEmbededAppSDK.min.js');
  await minifyFile(concatFile, outputFile);

  console.log(`\n✅ ZohoEmbededAppSDK.min.js built successfully: ${outputFile}\n`);
  return outputFile;
}

/**
 * Build WDK bundle
 */
async function buildWDK() {
  console.log('\n📦 Building wdk.min.js bundle...\n');

  // Step 1: Transpile files
  console.log('Step 1: Transpiling files...');
  WDK_FILES.forEach((file) => {
    const inputFile = path.join(LIB_DIR, file);
    const outputFile = path.join(TEMP_DIR, file);

    const configFile = file === 'ZSDK.js' ? '.babelrc' : '.babelrc.modern.json';
    transpileFile(inputFile, outputFile, configFile);
  });

  // Step 2: Concatenate
  console.log('\nStep 2: Concatenating files...');
  const concatFile = path.join(TEMP_DIR, 'wdk.concat.js');
  concatenateFiles(WDK_FILES, concatFile);

  // Step 3: Minify
  console.log('\nStep 3: Minifying...');
  const outputFile = path.join(BUILD_DIR, 'wdk.min.js');
  await minifyFile(concatFile, outputFile);

  console.log(`\n✅ wdk.min.js built successfully: ${outputFile}\n`);
  return outputFile;
}

/**
 * Build WApp bundle
 */
async function buildWApp() {
  console.log('\n📦 Building WApp.min.js bundle...\n');

  // Step 1: Transpile files
  console.log('Step 1: Transpiling files...');
  WAPP_FILES.forEach((file, index) => {
    const inputFile = path.join(LIB_DIR, file);
    const outputFile = path.join(TEMP_DIR, file);

    // Use legacy config for ZSDK, modern for others
    const configFile = file === 'ZSDK.js' ? '.babelrc' : '.babelrc.modern.json';
    transpileFile(inputFile, outputFile, configFile);
  });

  // Step 2: Concatenate
  console.log('\nStep 2: Concatenating files...');
  const concatFile = path.join(TEMP_DIR, 'WApp.concat.js');
  concatenateFiles(WAPP_FILES, concatFile);

  // Step 3: Minify
  console.log('\nStep 3: Minifying...');
  const outputFile = path.join(BUILD_DIR, 'WApp.min.js');
  await minifyFile(concatFile, outputFile);

  console.log(`\n✅ WApp.min.js built successfully: ${outputFile}\n`);
  return outputFile;
}

/**
 * Build WDKLite bundle (ultra-light SDK)
 */
async function buildWDKLite() {
  console.log('\n📦 Building wdk_lite.min.js bundle...\n');

  // Step 1: Transpile files
  console.log('Step 1: Transpiling files...');
  WDKLITE_FILES.forEach((file) => {
    const inputFile = path.join(LIB_DIR, file);
    const outputFile = path.join(TEMP_DIR, file);

    // Use legacy config for ZSDK, modern for others
    const configFile = file === 'ZSDK.js' ? '.babelrc' : '.babelrc.modern.json';
    transpileFile(inputFile, outputFile, configFile);
  });

  // Step 2: Concatenate
  console.log('\nStep 2: Concatenating files...');
  const concatFile = path.join(TEMP_DIR, 'WDKLite.concat.js');
  concatenateFiles(WDKLITE_FILES, concatFile);

  // Step 3: Minify
  console.log('\nStep 3: Minifying...');
  const outputFile = path.join(BUILD_DIR, 'wdk_lite.min.js');
  await minifyFile(concatFile, outputFile, {
    mangle: {
      reserved: ['ZSDK', 'ZOHO', 'ZDK', 'ZSDKUtil', 'ZSDKMessageManager', 'ZSDKEventManager', 'wdk']
    }
  });

  console.log(`\n✅ wdk_lite.min.js built successfully: ${outputFile}\n`);
  return outputFile;
}

/**
 * Clean build directories
 */
function clean() {
  console.log('🧹 Cleaning build directories...');

  [TEMP_DIR, BUILD_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      return;
    }

    fs.readdirSync(dir).forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.lstatSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    });
  });

  console.log('✓ Cleaned\n');
}

/**
 * Main build function
 */
async function build(bundleType = 'all') {
  console.log('🚀 Starting build process...\n');

  clean();

  try {
    if (bundleType === 'zoho' || bundleType === 'all') {
      await buildZohoEmbededAppSDK();
    }

    if (bundleType === 'wdk' || bundleType === 'all') {
      await buildWDK();
    }

    if (bundleType === 'wapp' || bundleType === 'all') {
      await buildWApp();
    }

    if (bundleType === 'wdklite' || bundleType === 'all') {
      await buildWDKLite();
    }

    console.log('✨ Build completed successfully!\n');
    console.log('Output files:');
    if (bundleType === 'zoho' || bundleType === 'all') {
      console.log(`  - ${path.join(BUILD_DIR, 'ZohoEmbededAppSDK.min.js')}`);
    }
    if (bundleType === 'wdk' || bundleType === 'all') {
      console.log(`  - ${path.join(BUILD_DIR, 'wdk.min.js')}`);
    }
    if (bundleType === 'wapp' || bundleType === 'all') {
      console.log(`  - ${path.join(BUILD_DIR, 'WApp.min.js')}`);
    }
    if (bundleType === 'wdklite' || bundleType === 'all') {
      console.log(`  - ${path.join(BUILD_DIR, 'wdk_lite.min.js')}`);
    }
    console.log('');

  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const bundleType = args.includes('--bundle')
  ? args[args.indexOf('--bundle') + 1] || 'all'
  : args.includes('--all') ? 'all'
  : 'all';

// Valid bundle types: all | zoho | wdk | wapp | wdklite

// Run build
build(bundleType).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
