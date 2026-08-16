import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract panels
start_marker = "      <!-- Presets & Sky/Foliage LUT Tab -->"

parts = content.split(start_marker)
before = parts[0]
after_start = start_marker + parts[1]

# We need to find the end of tab-history. It ends right before "    <!-- Center Panel: Main Viewport Workspace -->"
end_split = after_start.split("    <!-- Center Panel: Main Viewport Workspace -->")
panels = end_split[0].strip()
after_panels = "    <!-- Center Panel: Main Viewport Workspace -->\n" + end_split[1]

# Replace classes in panels
panels = panels.replace('class="tab-content active"', 'class="tool-panel" style="display:none; padding:12px; overflow-y:auto;"')
panels = panels.replace('class="tab-content"', 'class="tool-panel" style="display:none; padding:12px; overflow-y:auto;"')
panels = panels.replace('id="tab-presets"', 'id="panel-LUTS"')
panels = panels.replace('id="tab-masking"', 'id="panel-PROTECT"')
panels = panels.replace('id="tab-history"', 'id="panel-HISTORY"')

# Now insert panels into sidebar-right
sidebar_right_start = '<aside class="sidebar-right">'
sidebar_right_end = '    </aside>'

sidebar_parts = after_panels.split(sidebar_right_start)
before_sidebar = sidebar_parts[0]
inside_sidebar = sidebar_parts[1].split(sidebar_right_end)

new_sidebar = sidebar_right_start + '\n      <!-- Tool Panels Container -->\n      <div id="panel-ADJUST" class="tool-panel active" style="display:flex; flex-direction:column;">' + inside_sidebar[0] + '      </div>\n\n' + panels + '\n    </aside>'

new_content = before + "    </aside>\n\n" + before_sidebar + new_sidebar + inside_sidebar[1]

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(new_content)
