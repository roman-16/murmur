export const BUS_NAME = 'org.gnome.Shell';
export const INTERFACE = 'org.gnome.Shell.Extensions.Murmur';
export const OBJECT_PATH = '/org/gnome/Shell/Extensions/Murmur';

export const INTERFACE_XML = `<node>
  <interface name="${INTERFACE}">
    <method name="Transcribe">
      <arg type="s" direction="in" name="path"/>
      <arg type="s" direction="in" name="service"/>
    </method>
  </interface>
</node>`;
