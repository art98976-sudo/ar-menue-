import json, struct

def fix_glb_position(input_file, output_file, y_offset=-0.5):
    with open(input_file, 'rb') as f:
        data = f.read()
    
    magic = data[:4]
    version = struct.unpack('<I', data[4:8])[0]
    length = struct.unpack('<I', data[8:12])[0]
    
    json_length = struct.unpack('<I', data[12:16])[0]
    json_data = json.loads(data[20:20+json_length])
    
    if 'nodes' in json_data:
        for node in json_data['nodes']:
            if 'translation' not in node:
                node['translation'] = [0, 0, 0]
            node['translation'][1] += y_offset
    
    new_json = json.dumps(json_data).encode('utf-8')
    while len(new_json) % 4 != 0:
        new_json += b' '
    
    new_json_length = struct.pack('<I', len(new_json))
    new_total = 12 + 8 + len(new_json) + (length - 20 - json_length)
    new_length = struct.pack('<I', new_total)
    
    with open(output_file, 'wb') as f:
        f.write(magic)
        f.write(struct.pack('<I', version))
        f.write(new_length)
        f.write(new_json_length)
        f.write(data[16:20])
        f.write(new_json)
        f.write(data[20+json_length:])
    
    print(f"Fixed — {output_file} saved successfully")

fix_glb_position('burger.glb', 'burger_fixed.glb', y_offset=-0.5)
fix_glb_position('pizza.glb',  'pizza_fixed.glb',  y_offset=-0.5)
fix_glb_position('drink.glb',  'drink_fixed.glb',  y_offset=-0.5)