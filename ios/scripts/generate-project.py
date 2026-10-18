#!/usr/bin/env python3
"""Generate a dependency-free Xcode project with stable identifiers."""
from pathlib import Path
import hashlib
root = Path(__file__).resolve().parents[1]
objects = []
def uid(key): return hashlib.sha1(key.encode()).hexdigest()[:24].upper()
def ref(key): return uid(key)
def add(key, value): objects.append(f'{uid(key)} = {{ {value} }};'); return uid(key)
def array(values): return '(' + ', '.join(values) + (',' if values else '') + ')'
def settings(values): return '{ ' + ' '.join(f'{k} = {v};' for k,v in values.items()) + ' }'
targets = [('JobGenie','com.apple.product-type.application','app'), ('JobGenieTests','com.apple.product-type.bundle.unit-test','xctest'), ('JobGenieUITests','com.apple.product-type.bundle.ui-testing','xctest')]
groups=[]; products=[]
for name, kind, suffix in targets:
    files=[]; builds=[]
    for path in sorted((root/name).rglob('*.swift')):
        key = str(path.relative_to(root))
        files.append(add(key, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "{path.relative_to(root/name)}"; sourceTree = "<group>";'))
        builds.append(add(key+'build', f'isa = PBXBuildFile; fileRef = {ref(key)};'))
    if name == 'JobGenie': files.append(add('info', 'isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>";'))
    groups.append(add(name+'group', f'isa = PBXGroup; path = {name}; sourceTree = "<group>"; children = {array(files)};'))
    products.append(add(name+'product', f'isa = PBXFileReference; explicitFileType = {"wrapper.application" if suffix == "app" else "wrapper.cfbundle"}; path = {name}.{suffix}; sourceTree = BUILT_PRODUCTS_DIR;'))
    phases=[]
    for phase in ['Sources','Frameworks','Resources']:
        phases.append(add(name+phase, f'isa = PBX{phase}BuildPhase; buildActionMask = 2147483647; files = {array(builds if phase == "Sources" else [])}; runOnlyForDeploymentPostprocessing = 0;'))
    configs=[]
    for mode in ['Debug','Release']:
        s={'PRODUCT_NAME':'"$(TARGET_NAME)"','PRODUCT_BUNDLE_IDENTIFIER':f'com.enfoirer.jobgenie{("."+name) if suffix != "app" else ""}', 'SWIFT_VERSION':'5.0','TARGETED_DEVICE_FAMILY':'1','IPHONEOS_DEPLOYMENT_TARGET':'17.0','SDKROOT':'iphoneos','SUPPORTED_PLATFORMS':'"iphoneos iphonesimulator"','CODE_SIGN_STYLE':'Automatic','MARKETING_VERSION':'0.1.0','CURRENT_PROJECT_VERSION':'1','SWIFT_EMIT_LOC_STRINGS':'YES','SWIFT_STRICT_CONCURRENCY':'complete'}
        if mode == 'Debug': s.update({'SWIFT_ACTIVE_COMPILATION_CONDITIONS':'"DEBUG $(inherited)"','SWIFT_OPTIMIZATION_LEVEL':'"-Onone"','ENABLE_TESTABILITY':'YES'})
        else: s.update({'SWIFT_COMPILATION_MODE':'wholemodule','SWIFT_OPTIMIZATION_LEVEL':'"-O"','VALIDATE_PRODUCT':'YES'})
        if suffix == 'app': s.update({'INFOPLIST_FILE':'JobGenie/Info.plist','GENERATE_INFOPLIST_FILE':'NO','LD_RUNPATH_SEARCH_PATHS':'"$(inherited) @executable_path/Frameworks"'})
        else:
            s.update({'GENERATE_INFOPLIST_FILE':'YES','LD_RUNPATH_SEARCH_PATHS':'"$(inherited) @executable_path/Frameworks @loader_path/Frameworks"'})
            if name == 'JobGenieTests': s.update({'TEST_HOST':'"$(BUILT_PRODUCTS_DIR)/JobGenie.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/JobGenie"','BUNDLE_LOADER':'"$(TEST_HOST)"'})
            else: s['TEST_TARGET_NAME']='JobGenie'
        configs.append(add(name+mode, f'isa = XCBuildConfiguration; buildSettings = {settings(s)}; name = {mode};'))
    add(name+'configs', f'isa = XCConfigurationList; buildConfigurations = {array(configs)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
    deps=[]
    if suffix != 'app':
        proxy=add(name+'proxy', f'isa = PBXContainerItemProxy; containerPortal = {ref("project")}; proxyType = 1; remoteGlobalIDString = {ref("JobGenietarget")}; remoteInfo = JobGenie;')
        deps.append(add(name+'dep', f'isa = PBXTargetDependency; target = {ref("JobGenietarget")}; targetProxy = {proxy};'))
    add(name+'target', f'isa = PBXNativeTarget; buildConfigurationList = {ref(name+"configs")}; buildPhases = {array(phases)}; buildRules = (); dependencies = {array(deps)}; name = {name}; productName = {name}; productReference = {ref(name+"product")}; productType = "{kind}";')
productsGroup=add('products','isa = PBXGroup; name = Products; sourceTree = "<group>"; children = '+array(products)+';')
add('rootgroup',f'isa = PBXGroup; sourceTree = "<group>"; children = {array(groups+[productsGroup])};')
configs=[]
for mode in ['Debug','Release']:
    configs.append(add('project'+mode, f'isa = XCBuildConfiguration; name = {mode}; buildSettings = {{ CLANG_ENABLE_MODULES = YES; CLANG_ENABLE_OBJC_ARC = YES; }};'))
add('projectconfigs', f'isa = XCConfigurationList; buildConfigurations = {array(configs)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
add('project',f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 2600; }}; buildConfigurationList = {ref("projectconfigs")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = zh-Hans; hasScannedForEncodings = 0; knownRegions = ("zh-Hans", en, Base); mainGroup = {ref("rootgroup")}; productRefGroup = {productsGroup}; projectDirPath = ""; projectRoot = ""; targets = {array([ref(name+"target") for name,_,_ in targets])};')
(root/'JobGenie.xcodeproj/project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+'\n'.join(objects)+'\n}; rootObject = '+ref('project')+'; }\n')
def buildref(name): return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ref(name+"target")}" BuildableName="{name}{".app" if name == "JobGenie" else ".xctest"}" BlueprintName="{name}" ReferencedContainer="container:JobGenie.xcodeproj"/>'
scheme=f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{buildref('JobGenie')}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables>{''.join('<TestableReference skipped="NO">'+buildref(name)+'</TestableReference>' for name in ['JobGenieTests','JobGenieUITests'])}</Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildref('JobGenie')}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildref('JobGenie')}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>'''
(root/'JobGenie.xcodeproj/xcshareddata/xcschemes/JobGenie.xcscheme').write_text(scheme+'\n')
