#!/usr/bin/env node

/**
 * Modern build script for Zoho Embedded App SDK
 * Creates four separate bundles:
 * 1. WDK.min.js - Core SDK (ZSDK + Initialization + ZRC + ZohoCrmHelper)
 * 2. WApp.min.js - Lightweight SDK (ZSDK + Initialization + ZRC + WAppHelper)
 * 3. wdk-light.min.js - Ultra-light SDK (ZSDK + Initialization + ZRC + WDKLight)
 * 4. connector-helper.min.js - Connector Helper (standalone, requires WDK or WApp)
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

// File order for WDK bundle (core SDK)
const WDK_FILES = [
  'ZSDK.js',
  'Initialization.js',
  'ZRC.js',
  'ZohoCrmHelper.js'
];

// File order for WApp bundle (lightweight SDK)
const WAPP_FILES = [
  'ZSDK.js',
  'Initialization.js',
  'ZRC.js',
  'WAppHelper.js'
];

// File order for WDKLight bundle (ultra-light SDK)
const WDKLIGHT_FILES = [
  'ZSDK.js',
  'Initialization.js',
  'ZRC.js',
  'WDKLight.js'
];

// File order for Connector bundle
const CONNECTOR_FILES = [
  'ConnectorHelper.js'
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
 * Build WDK bundle
 */
async function buildWDK() {
  console.log('\n📦 Building WDK.min.js bundle...\n');
  
  // Step 1: Transpile files
  console.log('Step 1: Transpiling files...');
  WDK_FILES.forEach((file, index) => {
    const inputFile = path.join(LIB_DIR, file);
    const outputFile = path.join(TEMP_DIR, file);
    
    // Use legacy config for ZSDK, modern for others
    const configFile = file === 'ZSDK.js' ? '.babelrc' : '.babelrc.modern.json';
    transpileFile(inputFile, outputFile, configFile);
  });
  
  // Step 2: Concatenate
  console.log('\nStep 2: Concatenating files...');
  const concatFile = path.join(TEMP_DIR, 'WDK.concat.js');
  concatenateFiles(WDK_FILES, concatFile);
  
  // Step 3: Minify
  console.log('\nStep 3: Minifying...');
  const outputFile = path.join(BUILD_DIR, 'WDK.min.js');
  await minifyFile(concatFile, outputFile);
  
  console.log(`\n✅ WDK.min.js built successfully: ${outputFile}\n`);
  return outputFile;
}

/**
 * Build WApp bundle (lightweight SDK)
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
 * Build WDKLight bundle (ultra-light SDK)
 */
async function buildWDKLight() {
  console.log('\n📦 Building wdk-light.min.js bundle...\n');

  // Step 1: Transpile files
  console.log('Step 1: Transpiling files...');
  WDKLIGHT_FILES.forEach((file) => {
    const inputFile = path.join(LIB_DIR, file);
    const outputFile = path.join(TEMP_DIR, file);

    // Use legacy config for ZSDK, modern for others
    const configFile = file === 'ZSDK.js' ? '.babelrc' : '.babelrc.modern.json';
    transpileFile(inputFile, outputFile, configFile);
  });

  // Step 2: Concatenate
  console.log('\nStep 2: Concatenating files...');
  const concatFile = path.join(TEMP_DIR, 'WDKLight.concat.js');
  concatenateFiles(WDKLIGHT_FILES, concatFile);

  // Step 3: Minify
  console.log('\nStep 3: Minifying...');
  const outputFile = path.join(BUILD_DIR, 'wdk-light.min.js');
  await minifyFile(concatFile, outputFile, {
    mangle: {
      reserved: ['ZSDK', 'ZOHO', 'ZDK', 'ZSDKUtil', 'ZSDKMessageManager', 'ZSDKEventManager', 'wdk']
    }
  });

  console.log(`\n✅ wdk-light.min.js built successfully: ${outputFile}\n`);
  return outputFile;
}

/**
 * Build Connector Helper bundle
 */
async function buildConnector() {
  console.log('\n📦 Building connector-helper.min.js bundle...\n');
  
  // Step 1: Transpile
  console.log('Step 1: Transpiling files...');
  CONNECTOR_FILES.forEach(file => {
    const inputFile = path.join(LIB_DIR, file);
    const outputFile = path.join(TEMP_DIR, file);
    transpileFile(inputFile, outputFile, '.babelrc.modern.json');
  });
  
  // Step 2: Concatenate (only one file, but keeping for consistency)
  console.log('\nStep 2: Concatenating files...');
  const concatFile = path.join(TEMP_DIR, 'connector-helper.concat.js');
  concatenateFiles(CONNECTOR_FILES, concatFile);
  
  // Step 3: Minify
  console.log('\nStep 3: Minifying...');
  const outputFile = path.join(BUILD_DIR, 'connector-helper.min.js');
  await minifyFile(concatFile, outputFile);
  
  console.log(`\n✅ connector-helper.min.js built successfully: ${outputFile}\n`);
  console.log('⚠️  Note: connector-helper.min.js requires WDK.min.js to be loaded first\n');
  return outputFile;
}

/**
 * Clean build directories
 */
function clean() {
  console.log('🧹 Cleaning build directories...');
  [TEMP_DIR].forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(file => {
        fs.unlinkSync(path.join(dir, file));
      });
    }
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
    if (bundleType === 'wdk' || bundleType === 'all') {
      await buildWDK();
    }

    if (bundleType === 'wapp' || bundleType === 'all') {
      await buildWApp();
    }

    if (bundleType === 'wdklight' || bundleType === 'all') {
      await buildWDKLight();
    }
    
    if (bundleType === 'connector' || bundleType === 'all') {
      await buildConnector();
    }
    
    console.log('✨ Build completed successfully!\n');
    console.log('Output files:');
    if (bundleType === 'wdk' || bundleType === 'all') {
      console.log(`  - ${path.join(BUILD_DIR, 'WDK.min.js')}`);
    }
    if (bundleType === 'wapp' || bundleType === 'all') {
      console.log(`  - ${path.join(BUILD_DIR, 'WApp.min.js')}`);
    }
    if (bundleType === 'wdklight' || bundleType === 'all') {
      console.log(`  - ${path.join(BUILD_DIR, 'wdk-light.min.js')}`);
    }
    if (bundleType === 'connector' || bundleType === 'all') {
      console.log(`  - ${path.join(BUILD_DIR, 'connector-helper.min.js')}`);
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

// Valid bundle types: all | wdk | wapp | wdklight | connector

// Run build
build(bundleType).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
