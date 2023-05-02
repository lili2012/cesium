import addPipelineExtras from "./addPipelineExtras.js";
import removeExtensionsUsed from "./removeExtensionsUsed.js";
import defaultValue from "../../Core/defaultValue.js";
import defined from "../../Core/defined.js";
import getMagic from "../../Core/getMagic.js";
import getStringFromTypedArray from "../../Core/getStringFromTypedArray.js";
import RuntimeError from "../../Core/RuntimeError.js";

const sizeOfUint32 = 4;

/**
 * Convert a binary glTF to glTF.
 *
 * The returned glTF has pipeline extras included. The embedded binary data is stored in gltf.buffers[0].extras._pipeline.source.
 *
 * @param {Buffer} glb The glb data to parse.
 * @returns {object} A javascript object containing a glTF asset with pipeline extras included.
 *
 * @private
 */
function parseGlb(glb) {
  // Check that the magic string is present
  const magic = getMagic(glb);
  if (magic !== "glTF") {
    throw new RuntimeError("File is not valid binary glTF");
  }

  const header = readHeader(glb, 0, 5);
  const version = header[1];
  if (version !== 1 && version !== 2) {
    throw new RuntimeError("Binary glTF version is not 1 or 2");
  }

  if (version === 1) {
    return parseGlbVersion1(glb, header);
  }

  return parseGlbVersion2(glb, header);
}

function readHeader(glb, byteOffset, count) {
  const dataView = new DataView(glb.buffer);
  const header = new Array(count);
  for (let i = 0; i < count; ++i) {
    header[i] = dataView.getUint32(
      glb.byteOffset + byteOffset + i * sizeOfUint32,
      true
    );
  }
  return header;
}

function fixGltf(gltf) {
  if (!gltf.extensionsUsed) {
      return;
  }

  var v = gltf.extensionsUsed.indexOf('KHR_technique_webgl');
  var t = gltf.extensionsRequired.indexOf('KHR_technique_webgl');
  // 中招了。。
  if (v !== -1) {
      gltf.extensionsRequired.splice(t, 1, 'KHR_techniques_webgl');
      gltf.extensionsUsed.splice(v, 1, 'KHR_techniques_webgl');
      gltf.extensions = gltf.extensions || {};
      gltf.extensions['KHR_techniques_webgl'] = {};
      gltf.extensions['KHR_techniques_webgl'].programs = gltf.programs;
      gltf.extensions['KHR_techniques_webgl'].shaders = gltf.shaders;
      gltf.extensions['KHR_techniques_webgl'].techniques = gltf.techniques;
      var techniques = gltf.extensions['KHR_techniques_webgl'].techniques;

      gltf.materials.forEach(function (mat, index) {
        gltf.materials[index].extensions={};
        gltf.materials[index].extensions['KHR_technique_webgl']={};
        gltf.materials[index].extensions['KHR_technique_webgl'].values={};
          gltf.materials[index].extensions['KHR_technique_webgl'].values = gltf.materials[index].values;
          gltf.materials[index].extensions['KHR_techniques_webgl'] = gltf.materials[index].extensions['KHR_technique_webgl'];

          var vtxfMaterialExtension = gltf.materials[index].extensions['KHR_techniques_webgl'];
          vtxfMaterialExtension.technique = 0;
          for (var value in vtxfMaterialExtension.values) {
              //var us = techniques[vtxfMaterialExtension.technique].uniforms;
              var us = techniques[0].uniforms;
              for (var key in us) {
                  if (us[key] === value) {
                      vtxfMaterialExtension.values[key] = vtxfMaterialExtension.values[value];
                      delete vtxfMaterialExtension.values[value];
                      break;
                  }
              }
          };
      });

      techniques.forEach(function (t) {
          for (var attribute in t.attributes) {
              var name = t.attributes[attribute];
              t.attributes[attribute] = t.parameters[name];
          };

          for (var uniform in t.uniforms) {
              var name = t.uniforms[uniform];
              t.uniforms[uniform] = t.parameters[name];
          };
      });
  }

  delete gltf.materials[0].technique;
  delete gltf.materials[0].values;
  delete gltf.programs;
  delete gltf.shaders;
  delete gltf.techniques;
}

function parseGlbVersion1(glb, header) {
  const length = header[2];
  const contentLength = header[3];
  const contentFormat = header[4];

  // Check that the content format is 0, indicating that it is JSON
  if (contentFormat !== 0) {
    throw new RuntimeError("Binary glTF scene format is not JSON");
  }

  const jsonStart = 20;
  const binaryStart = jsonStart + contentLength;

  const contentString = getStringFromTypedArray(glb, jsonStart, contentLength);
  const gltf = JSON.parse(contentString);
  addPipelineExtras(gltf);

  const binaryBuffer = glb.subarray(binaryStart, length);

  const buffers = gltf.buffers;
  if (defined(buffers) && Object.keys(buffers).length > 0) {
    // In some older models, the binary glTF buffer is named KHR_binary_glTF
    const binaryGltfBuffer = defaultValue(
      buffers.binary_glTF,
      buffers.KHR_binary_glTF
    );
    if (defined(binaryGltfBuffer)) {
      binaryGltfBuffer.extras._pipeline.source = binaryBuffer;
      delete binaryGltfBuffer.uri;
    }
  }
  // Remove the KHR_binary_glTF extension
  removeExtensionsUsed(gltf, "KHR_binary_glTF");
  return gltf;
}

function parseGlbVersion2(glb, header) {
  const length = header[2];
  let byteOffset = 12;
  let gltf;
  let binaryBuffer;
  while (byteOffset < length) {
    const chunkHeader = readHeader(glb, byteOffset, 2);
    const chunkLength = chunkHeader[0];
    const chunkType = chunkHeader[1];
    byteOffset += 8;
    const chunkBuffer = glb.subarray(byteOffset, byteOffset + chunkLength);
    byteOffset += chunkLength;
    // Load JSON chunk
    if (chunkType === 0x4e4f534a) {
      const jsonString = getStringFromTypedArray(chunkBuffer);
      gltf = JSON.parse(jsonString);
      fixGltf(gltf);
      // let hasKHR_techniques_webgl = false;
      // if(gltf.extensionsRequired){
      //   const n = gltf.extensionsRequired.length;
      //   for(let i = 0; i< n; i++){
      //     if(gltf.extensionsRequired[i] === 'KHR_technique_webgl'){
      //       gltf.extensionsRequired[i]='KHR_techniques_webgl';
      //       hasKHR_techniques_webgl = true;
      //     }
      //   }
      // }
      // if(gltf.extensionsUsed){
      //   const n = gltf.extensionsUsed.length;
      //   for(let i = 0; i< n; i++){
      //     if(gltf.extensionsUsed[i] === 'KHR_technique_webgl'){
      //       gltf.extensionsUsed[i]='KHR_techniques_webgl';
      //       hasKHR_techniques_webgl = true;
      //     }
      //   }
      // }

      // if(hasKHR_techniques_webgl){
      //   const material0 = gltf.materials[0];
      //   material0.extensions={};
      //   material0.extensions.KHR_techniques_webgl={};
      //   material0.extensions.KHR_techniques_webgl.technique=material0.technique;
      //   material0.extensions.KHR_techniques_webgl.values=gltf.materials[0].values;
      //   delete material0.technique;
      //   delete material0.values;

      //   const KHR_techniques_webgl ={};
      //   KHR_techniques_webgl.programs= gltf.programs;
      //   KHR_techniques_webgl.shaders= gltf.shaders;
      //   KHR_techniques_webgl.techniques = gltf.techniques;
      //   gltf.extensions={};
      //   gltf.extensions.KHR_techniques_webgl = KHR_techniques_webgl;
      //   delete gltf.programs;
      //   delete gltf.shaders;
      //   delete gltf.techniques;
      // }
      // console.log(JSON.stringify(gltf));


      addPipelineExtras(gltf);
    }
    // Load Binary chunk
    else if (chunkType === 0x004e4942) {
      binaryBuffer = chunkBuffer;
    }
  }
  if (defined(gltf) && defined(binaryBuffer)) {
    const buffers = gltf.buffers;
    if (defined(buffers) && buffers.length > 0) {
      const buffer = buffers[0];
      buffer.extras._pipeline.source = binaryBuffer;
    }
  }
  return gltf;
}

export default parseGlb;
